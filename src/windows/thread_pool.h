// src/windows/thread_pool.h
#pragma once
#include "../common/debug_log.h"
#include "windows_arch.h"
#include <atomic>
#include <functional>
#include <memory>
#include <queue>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace FSMeta {

// Thread-safe work queue
class WorkQueue {
private:
  std::queue<std::function<void()>> tasks;
  CRITICAL_SECTION cs;
  HANDLE workAvailable = nullptr;
  std::atomic<bool> shutdown{false};
  bool initialized = false;

public:
  WorkQueue() {
    InitializeCriticalSection(&cs);
    // CreateEvent returns NULL on failure, not INVALID_HANDLE_VALUE.
    // See:
    // https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-createeventa
    workAvailable = CreateEvent(nullptr, FALSE, FALSE, nullptr);
    if (workAvailable == nullptr) {
      DWORD error = GetLastError();
      DeleteCriticalSection(&cs);
      DEBUG_LOG("[WorkQueue] CreateEvent failed with error: %lu", error);
      throw std::runtime_error("WorkQueue: CreateEvent failed with error " +
                               std::to_string(error));
    }
    initialized = true;
  }

  ~WorkQueue() {
    shutdown = true;
    if (workAvailable != nullptr) {
      SetEvent(workAvailable);
      CloseHandle(workAvailable);
      workAvailable = nullptr;
    }
    if (initialized) {
      DeleteCriticalSection(&cs);
    }
  }

  // Delete copy/move operations - WorkQueue manages non-copyable resources
  WorkQueue(const WorkQueue &) = delete;
  WorkQueue &operator=(const WorkQueue &) = delete;
  WorkQueue(WorkQueue &&) = delete;
  WorkQueue &operator=(WorkQueue &&) = delete;

  void Push(std::function<void()> task) {
    EnterCriticalSection(&cs);
    tasks.push(std::move(task));
    LeaveCriticalSection(&cs);
    SetEvent(workAvailable);
  }

  bool Pop(std::function<void()> &task, DWORD timeoutMs = INFINITE) {
    if (shutdown)
      return false;

    DWORD result = WaitForSingleObject(workAvailable, timeoutMs);
    if (result != WAIT_OBJECT_0)
      return false;

    EnterCriticalSection(&cs);
    if (!tasks.empty() && !shutdown) {
      task = std::move(tasks.front());
      tasks.pop();
      if (!tasks.empty()) {
        SetEvent(workAvailable); // Signal more work available
      }
    }
    LeaveCriticalSection(&cs);

    return !shutdown && task != nullptr;
  }

  void Shutdown() {
    shutdown = true;
    SetEvent(workAvailable);
  }

  bool IsShutdown() const { return shutdown; }
};

// Managed thread pool for IO operations
class ThreadPool {
private:
  struct ThreadData {
    HANDLE handle;
    DWORD id;
    std::atomic<bool> running{true};
  };

  std::vector<std::unique_ptr<ThreadData>> threads;
  std::shared_ptr<WorkQueue> queue;
  CRITICAL_SECTION poolCs;

  static DWORD WINAPI WorkerThread(LPVOID param) {
    auto *data =
        static_cast<std::pair<ThreadData *, std::shared_ptr<WorkQueue>> *>(
            param);
    auto *threadData = data->first;
    auto queue = data->second;
    delete data;

    DEBUG_LOG("[ThreadPool] Worker thread %lu started", threadData->id);

    while (threadData->running && !queue->IsShutdown()) {
      std::function<void()> task;
      if (queue->Pop(task, 1000)) {
        try {
          task();
        } catch (...) {
          DEBUG_LOG("[ThreadPool] Worker thread %lu caught exception",
                    threadData->id);
        }
      }
    }

    DEBUG_LOG("[ThreadPool] Worker thread %lu exiting", threadData->id);
    return 0;
  }

public:
  explicit ThreadPool(size_t numThreads = 4)
      : queue(std::make_shared<WorkQueue>()) {
    // Clamp the thread count: hardware_concurrency() may return 0, and
    // Shutdown() waits on every worker with a single WaitForMultipleObjects
    // call, which fails outright past MAXIMUM_WAIT_OBJECTS (64) handles.
    // An IO-probe pool gains nothing beyond that anyway.
    if (numThreads == 0) {
      numThreads = 1;
    } else if (numThreads > MAXIMUM_WAIT_OBJECTS) {
      numThreads = MAXIMUM_WAIT_OBJECTS;
    }
    InitializeCriticalSection(&poolCs);

    for (size_t i = 0; i < numThreads; ++i) {
      auto threadData = std::make_unique<ThreadData>();

      // Pass both thread data and queue to worker
      auto *param = new std::pair<ThreadData *, std::shared_ptr<WorkQueue>>(
          threadData.get(), queue);

      threadData->handle =
          CreateThread(nullptr, 0, WorkerThread, param, 0, &threadData->id);

      if (threadData->handle) {
        threads.push_back(std::move(threadData));
      } else {
        delete param;
        DEBUG_LOG("[ThreadPool] Failed to create worker thread");
      }
    }

    DEBUG_LOG("[ThreadPool] Created with %zu threads", threads.size());
  }

  ~ThreadPool() {
    Shutdown();
    DeleteCriticalSection(&poolCs);
  }

  void Submit(std::function<void()> task) {
    if (!queue->IsShutdown()) {
      queue->Push(std::move(task));
    }
  }

  void Shutdown() {
    DEBUG_LOG("[ThreadPool] Shutting down with timeout 5000 ms");

    // Signal shutdown
    queue->Shutdown();

    // Stop all threads
    EnterCriticalSection(&poolCs);
    for (auto &thread : threads) {
      thread->running = false;
    }
    LeaveCriticalSection(&poolCs);

    // Wait for threads to exit with timeout
    std::vector<HANDLE> handles;
    for (const auto &thread : threads) {
      if (thread->handle) {
        handles.push_back(thread->handle);
      }
    }

    if (!handles.empty()) {
      // The constructor clamps the pool to MAXIMUM_WAIT_OBJECTS threads, so
      // a single WaitForMultipleObjects call can cover every worker.
      DWORD result = WaitForMultipleObjects(static_cast<DWORD>(handles.size()),
                                            handles.data(), TRUE, 5000);

      if (result == WAIT_TIMEOUT || result == WAIT_FAILED) {
        DEBUG_LOG("[ThreadPool] WARNING: wait for %zu threads returned %lu "
                  "(error %lu)",
                  handles.size(), result,
                  result == WAIT_FAILED ? GetLastError() : 0);
        // Note: TerminateThread is dangerous and not recommended
      }
    }

    // Free per-thread state only for threads that have actually exited. A
    // worker that is still running (hung task, wait timeout) holds a raw
    // ThreadData* — freeing it here would be a use-after-free, so leak that
    // state instead. The worker keeps the queue alive via its shared_ptr.
    for (auto &thread : threads) {
      if (!thread->handle) {
        continue;
      }
      const bool exited =
          WaitForSingleObject(thread->handle, 0) == WAIT_OBJECT_0;
      CloseHandle(thread->handle);
      thread->handle = nullptr;
      if (!exited) {
        DEBUG_LOG("[ThreadPool] Worker thread %lu still running; leaking its "
                  "ThreadData",
                  thread->id);
        thread.release(); // deliberate leak — the worker may still read it
      }
    }

    threads.clear();
    DEBUG_LOG("[ThreadPool] Shutdown complete");
  }

  // Delete copy/move operations
  ThreadPool(const ThreadPool &) = delete;
  ThreadPool &operator=(const ThreadPool &) = delete;
  ThreadPool(ThreadPool &&) = delete;
  ThreadPool &operator=(ThreadPool &&) = delete;
};

// Global thread pool instance (lazy initialized)
inline ThreadPool &GetGlobalThreadPool() {
  static ThreadPool pool(std::thread::hardware_concurrency());
  return pool;
}

} // namespace FSMeta