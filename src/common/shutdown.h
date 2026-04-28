// src/common/shutdown.h
// Shutdown-safety helpers: a per-env flag set during Node env teardown,
// plus deferred Resolve/Reject wrappers that swallow C++ Napi errors so they
// can never escape AsyncWorker callbacks.
//
// Why this exists: AsyncWorker::OnWorkComplete can run during
// node::FreeEnvironment cleanup. If napi_resolve_deferred / napi_reject_deferred
// fail at that point (env tearing down), node-addon-api throws a C++
// Napi::Error. With NAPI_CPP_EXCEPTIONS the rethrow path inside
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

// Registers per-env shutdown state and a cleanup hook that flips the flag.
// Idempotent per env: binding.cpp Init runs once per env load.
inline void EnsureShutdownHook(napi_env env) {
  if (GetInstanceData(env) != nullptr) {
    return;
  }
  auto *data = new ModuleInstanceData();
  auto *cleanupState = new std::shared_ptr<ShutdownState>(data->shutdownState);
  napi_status status = napi_set_instance_data(
      env, data,
      [](napi_env /*env*/, void *raw, void * /*hint*/) {
        delete static_cast<ModuleInstanceData *>(raw);
      },
      nullptr);
  if (status != napi_ok) {
    delete cleanupState;
    delete data;
    return;
  }
  status = napi_add_env_cleanup_hook(
      env,
      [](void *arg) {
        auto *state = static_cast<std::shared_ptr<ShutdownState> *>(arg);
        (*state)->shuttingDown.store(true, std::memory_order_release);
        delete state;
      },
      cleanupState);
  if (status != napi_ok) {
    delete cleanupState;
  }
}

// Wrap deferred.Resolve so a teardown-time napi failure cannot escape the
// AsyncWorker callback as an uncaught C++ exception.
inline void SafeResolve(const Napi::Promise::Deferred &deferred,
                        napi_value value) {
  try {
    deferred.Resolve(value);
  } catch (...) {
    // Env is tearing down; the JS-side promise is unobservable anyway.
  }
}

inline void SafeReject(const Napi::Promise::Deferred &deferred,
                       napi_value value) {
  try {
    deferred.Reject(value);
  } catch (...) {
    // Env is tearing down; the JS-side promise is unobservable anyway.
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
    if (status != napi_cancelled && !IsShuttingDown()) {
      try {
        Napi::HandleScope scope(env);
        if (status != napi_ok) {
          OnError(Napi::Error::New(env));
        } else if (error_.empty()) {
          OnOK();
        } else {
          OnError(Napi::Error::New(env, error_));
        }
      } catch (...) {
        // Env teardown can make value construction, handle scopes, or deferred
        // resolution fail. The JS promise is no longer observable then.
      }
    }
    Destroy();
  }

protected:
  explicit SafeAsyncWorker(Napi::Env env)
      : Napi::AsyncWorker(env), shutdownState_(GetShutdownState(env)) {}

  void SetError(const std::string &error) { error_ = error; }

  bool IsShuttingDown() const {
    return FSMeta::IsShuttingDown(shutdownState_);
  }

private:
  std::shared_ptr<ShutdownState> shutdownState_;
  std::string error_;
};

} // namespace FSMeta
