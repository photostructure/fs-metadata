// src/common/shutdown.h
// Shutdown-safety helpers: a per-env flag set during Node env teardown,
// plus deferred Resolve/Reject wrappers that swallow C++ Napi errors so they
// can never escape AsyncWorker callbacks.
//
// Why this exists: AsyncWorker::OnWorkComplete can run during
// node::FreeEnvironment cleanup. If napi_resolve_deferred /
// napi_reject_deferred fail at that point (env tearing down), node-addon-api
// throws a C++ Napi::Error. With NAPI_CPP_EXCEPTIONS the rethrow path inside
// WrapVoidCallback then calls ThrowAsJavaScriptException, which can also fail,
// letting the C++ exception escape into a libuv cleanup hook frame that has
// no catch - terminate() / SIGABRT.
//
// The flag is stored as napi instance data so worker threads (each their own
// env) don't poison the main env's flag when they tear down.
//

#pragma once

#include <atomic>
#include <memory>
#include <napi.h>
#include <string>

namespace FSMeta {

struct ShutdownState {
  std::atomic<bool> shuttingDown{false};
};

struct ModuleInstanceData {
  std::shared_ptr<ShutdownState> shutdownState =
      std::make_shared<ShutdownState>();
};

inline ModuleInstanceData *GetInstanceData(napi_env env) {
  void *raw = nullptr;
  if (napi_get_instance_data(env, &raw) != napi_ok) {
    return nullptr;
  }
  return static_cast<ModuleInstanceData *>(raw);
}

inline bool IsShuttingDown(napi_env env) {
  if (auto *d = GetInstanceData(env)) {
    return d->shutdownState->shuttingDown.load(std::memory_order_acquire);
  }
  // No instance data registered (test harness, etc.) - fail safe: not shutting.
  return false;
}

inline std::shared_ptr<ShutdownState> GetShutdownState(napi_env env) {
  if (auto *d = GetInstanceData(env)) {
    return d->shutdownState;
  }
  return nullptr;
}

inline bool IsShuttingDown(const std::shared_ptr<ShutdownState> &state) {
  return state != nullptr &&
         state->shuttingDown.load(std::memory_order_acquire);
}

// Env cleanup hook: flips the shutdown flag during normal environment teardown
// (node::FreeEnvironment) so in-flight SafeAsyncWorkers short-circuit instead
// of touching napi as the env is destroyed. A named function (not a lambda) so
// the instance-data finalizer can pass the same function pointer to
// napi_remove_env_cleanup_hook.
inline void ShutdownFlagHook(void *arg) {
  auto *data = static_cast<ModuleInstanceData *>(arg);
  data->shutdownState->shuttingDown.store(true, std::memory_order_release);
}

// Registers per-env shutdown state, a cleanup hook that flips the flag, and an
// instance-data finalizer that owns teardown. Idempotent per env: binding.cpp
// Init runs once per env load.
//
// Lifetime is anchored to the finalizer, not the cleanup hook: Node >= 26 may
// skip napi_add_env_cleanup_hook callbacks on an abrupt process.exit() while
// still running instance-data finalizers. Freeing `data` from the finalizer
// (and removing the hook there so it can never fire on freed memory) keeps
// teardown leak-free whether or not the cleanup hook runs. There is no separate
// heap allocation to strand.
inline void EnsureShutdownHook(napi_env env) {
  if (GetInstanceData(env) != nullptr) {
    return;
  }
  auto *data = new ModuleInstanceData();
  napi_status status = napi_set_instance_data(
      env, data,
      [](napi_env env, void *raw, void * /*hint*/) {
        auto *d = static_cast<ModuleInstanceData *>(raw);
        // Remove before freeing; no-op if the hook already ran during a normal
        // FreeEnvironment teardown.
        napi_remove_env_cleanup_hook(env, ShutdownFlagHook, d);
        delete d;
      },
      nullptr);
  if (status != napi_ok) {
    delete data;
    return;
  }
  // Best-effort: if this fails, the finalizer still frees `data`; the only loss
  // is the teardown flag never flipping (matching behavior before this hook
  // existed).
  napi_add_env_cleanup_hook(env, ShutdownFlagHook, data);
}

// Wrap deferred.Resolve so a teardown-time napi failure cannot escape the
// AsyncWorker callback as an uncaught C++ exception.
inline void SafeResolve(const Napi::Promise::Deferred &deferred,
                        napi_value value) {
  try {
    deferred.Resolve(value);
  } catch (...) { // NOLINT(bugprone-empty-catch)
    // Swallowing is the POINT of this function: env is tearing down, the
    // JS-side promise is unobservable, and letting the Napi::Error escape an
    // AsyncWorker callback would cross the C ABI into a libuv cleanup frame
    // with no catch -> terminate()/SIGABRT. See the file header.
  }
}

inline void SafeReject(const Napi::Promise::Deferred &deferred,
                       napi_value value) {
  try {
    deferred.Reject(value);
  } catch (...) { // NOLINT(bugprone-empty-catch)
    // Deliberate: see SafeResolve above.
  }
}

class SafeAsyncWorker : public Napi::AsyncWorker {
public:
  void OnExecute(Napi::Env /*env*/) override {
    try {
      Execute();
    } catch (const std::exception &e) {
      SetError(e.what());
    } catch (...) {
      SetError("Unknown native error");
    }
  }

  void OnWorkComplete(Napi::Env env, napi_status status) override {
    if (IsShuttingDown()) {
      Destroy();
      return;
    }

    try {
      // node-addon-api treats every non-cancelled status alike. Preserve the
      // stronger behavior this wrapper historically provided: a failed async
      // work status must reject even when Execute() did not set an error.
      if (status != napi_ok && status != napi_cancelled) {
        Napi::HandleScope scope(env);
        OnError(Napi::Error::New(env));
        Destroy();
        return;
      }

      // Keep node-addon-api's error storage and completion behavior as the
      // single source of truth. The qualified call still dispatches the
      // virtual OnOK/OnError implementations in concrete workers.
      Napi::AsyncWorker::OnWorkComplete(env, status);
    } catch (...) { // NOLINT(bugprone-empty-catch)
      // Deliberate: env teardown can make value construction, handle scopes,
      // or deferred resolution fail. The JS promise is no longer observable,
      // and an escaping C++ exception here would abort the process. Destroy()
      // is needed because node-addon-api could not reach its final cleanup.
      Destroy();
    }
  }

protected:
  explicit SafeAsyncWorker(Napi::Env env)
      : Napi::AsyncWorker(env), shutdownState_(GetShutdownState(env)) {}

  bool IsShuttingDown() const { return FSMeta::IsShuttingDown(shutdownState_); }

private:
  std::shared_ptr<ShutdownState> shutdownState_;
};

} // namespace FSMeta
