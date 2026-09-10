#include "./native_job.h"
#include "../common/shutdown.h"
#include <algorithm>
#include <deque>
#include <dlfcn.h>
#include <mutex>
#include <thread>
#include <uv.h>

namespace FSMeta {

Napi::Error NativeSystemError(Napi::Env env, const std::string &message,
                              int code, const std::string &syscall,
                              const std::string &path) {
  const int uvCode = uv_translate_sys_error(code);
  const char *name = uv_err_name(uvCode);
  auto error = Napi::Error::New(env, std::string(name) + ": " + message);
  error.Set("code", name);
  error.Set("errno", Napi::Number::New(env, uvCode));
  if (!syscall.empty())
    error.Set("syscall", syscall);
  if (!path.empty())
    error.Set("path", path);
  return error;
}

namespace {

struct JobQueue {
  std::mutex mutex;
  std::deque<std::shared_ptr<NativeJob>> pending;
  size_t running = 0;
};

JobQueue *GetJobQueue() {
  // Detached threads can finish after environment and static teardown.
  static JobQueue *const queue = new JobQueue();
  return queue;
}

void RemoveCancelledJobs() {
  auto *queue = GetJobQueue();
  std::lock_guard<std::mutex> lock(queue->mutex);
  std::erase_if(queue->pending,
                [](const auto &entry) { return entry->IsCancelled(); });
}

void PinAddon() {
  static const bool pinned = [] {
    Dl_info info{};
    if (dladdr(reinterpret_cast<const void *>(&PinAddon), &info) == 0) {
      throw std::runtime_error("Unable to locate fs-metadata addon image");
    }
    void *handle =
        dlopen(info.dli_fname, RTLD_LAZY | RTLD_LOCAL | RTLD_NODELETE);
    if (!handle)
      throw std::runtime_error("Unable to pin fs-metadata addon image");
    // NODELETE keeps code mapped even when the last Worker unloads the addon.
    dlclose(handle);
    return true;
  }();
  (void)pinned;
}

bool Submit(const std::shared_ptr<NativeJob> &job) {
  PinAddon();
  auto *queue = GetJobQueue();
  constexpr size_t maxThreads = 4;
  constexpr size_t maxPending = 256;
  std::lock_guard<std::mutex> lock(queue->mutex);
  std::erase_if(queue->pending,
                [](const auto &entry) { return entry->IsCancelled(); });
  if (queue->pending.size() >= maxPending)
    return false;
  queue->pending.push_back(job);
  if (queue->running < maxThreads) {
    ++queue->running;
    try {
      std::thread([queue] {
        for (;;) {
          std::shared_ptr<NativeJob> next;
          {
            std::lock_guard<std::mutex> lock(queue->mutex);
            if (queue->pending.empty()) {
              --queue->running;
              return;
            }
            next = std::move(queue->pending.front());
            queue->pending.pop_front();
          }
          next->Run();
        }
      }).detach();
    } catch (...) {
      --queue->running;
      queue->pending.pop_back();
      throw;
    }
  }
  return true;
}

struct Request {
  uv_timer_t timer{};
  napi_async_cleanup_hook_handle cleanup = nullptr;
  Napi::Promise::Deferred deferred;
  std::shared_ptr<NativeJob> job;
  bool closing = false;

  Request(Napi::Env env, std::shared_ptr<NativeJob> work)
      : deferred(Napi::Promise::Deferred::New(env)), job(std::move(work)) {}

  void Close() {
    if (closing)
      return;
    closing = true;
    job->Cancel();
    RemoveCancelledJobs();
    uv_timer_stop(&timer);
    uv_close(reinterpret_cast<uv_handle_t *>(&timer), [](uv_handle_t *handle) {
      auto *request = static_cast<Request *>(handle->data);
      // Also tells Node that asynchronous env cleanup has completed. The
      // native job may still run, but owns no request, env, or uv handle.
      if (request->cleanup)
        napi_remove_async_cleanup_hook(request->cleanup);
      delete request;
    });
  }

  static void Poll(uv_timer_t *timer) {
    auto *request = static_cast<Request *>(timer->data);
    const bool ready = request->job->Ready();
    if (!ready && !request->job->Expired())
      return;
    try {
      const auto env = request->deferred.Env();
      Napi::HandleScope scope(env);
      if (ready && !request->job->TimedOut()) {
        SafeResolve(request->deferred, request->job->Result(env));
      } else {
        auto error =
            Napi::Error::New(env, "fs-metadata: native operation timeout");
        error.Set("code", "ETIMEDOUT");
        SafeReject(request->deferred, error.Value());
      }
    } catch (const Napi::Error &error) {
      try {
        Napi::HandleScope scope(request->deferred.Env());
        SafeReject(request->deferred, error.Value());
      } catch (...) { // Env teardown can also prevent opening a handle scope.
        request->Close();
        return;
      }
    } catch (const std::exception &error) {
      try {
        auto env = request->deferred.Env();
        Napi::HandleScope scope(env);
        SafeReject(request->deferred,
                   Napi::Error::New(env, error.what()).Value());
      } catch (...) { // Env teardown can make even error construction fail.
        request->Close();
        return;
      }
    } catch (...) { // Never let exceptions cross libuv's C callback boundary.
      request->Close();
      return;
    }
    request->Close();
  }
};
} // namespace

Napi::Promise QueueNativeJob(Napi::Env env, std::shared_ptr<NativeJob> job) {
  auto request = std::make_unique<Request>(env, std::move(job));
  auto promise = request->deferred.Promise();
  uv_loop_t *loop = nullptr;
  if (napi_get_uv_event_loop(env, &loop) != napi_ok ||
      uv_timer_init(loop, &request->timer) != 0) {
    throw Napi::Error::New(env, "Unable to initialize native operation timer");
  }
  Request *raw = request.release(); // Owned by the uv_close callback now.
  raw->timer.data = raw;
  try {
    if (napi_add_async_cleanup_hook(
            env,
            [](napi_async_cleanup_hook_handle, void *data) {
              static_cast<Request *>(data)->Close();
            },
            raw, &raw->cleanup) != napi_ok) {
      throw std::runtime_error("Unable to register native operation cleanup");
    }
    // Polling is deliberate: late native completions never call N-API/libuv.
    // A referenced timer preserves normal pending-operation liveness even for
    // timeoutMs: 0. process.exit() does not wait for this timer.
    if (uv_timer_start(&raw->timer, Request::Poll, 0, 5) != 0) {
      throw std::runtime_error("Unable to start native operation timer");
    }
    if (!Submit(raw->job)) {
      auto error =
          Napi::Error::New(env, "fs-metadata: native operation queue busy");
      error.Set("code", "EBUSY");
      SafeReject(raw->deferred, error.Value());
      raw->Close();
    }
  } catch (const std::exception &error) {
    raw->Close();
    SafeReject(raw->deferred, Napi::Error::New(env, error.what()).Value());
  }
  return promise;
}
} // namespace FSMeta
