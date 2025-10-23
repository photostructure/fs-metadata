// src/windows/thread_pool.h
#pragma once
#include "../common/debug_log.h"
#include "windows_arch.h"
#include <atomic>
#include <functional>
#include <memory>
#include <queue>
#include <thread>
#include <vector>

namespace FSMeta {

// Thread-safe work queue
class WorkQueue {
private:
  std::queue<std::function<void()>> tasks;
  CRITICAL_SECTION cs;
  HANDLE workAvailable;
  std::atomic<bool> shutdown{false};

public:
  WorkQueue() {
    InitializeCriticalSection(&cs);
    workAvailable = CreateEvent(nullptr, FALSE, FALSE, nullptr);
  }

  ~WorkQueue() {
    shutdown = true;
    SetEvent(workAvailable);
    CloseHandle(workAvailable);
    DeleteCriticalSection(&cs);
  }

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
      DWORD result = WaitForMultipleObjects(static_cast<DWORD>(handles.size()),
                                            handles.data(), TRUE, 5000);

      if (result == WAIT_TIMEOUT) {
        DEBUG_LOG("[ThreadPool] WARNING: %zu threads did not exit within 5000 ms",
                  handles.size());
        // Note: TerminateThread is dangerous and not recommended
        // Threads will be forcefully terminated when process exits
      }
    }

    // Close handles
    for (auto &thread : threads) {
      if (thread->handle) {
        CloseHandle(thread->handle);
        thread->handle = nullptr;
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