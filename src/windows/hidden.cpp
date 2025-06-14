// src/windows/hidden.cpp
#include "hidden.h"
#include "../common/debug_log.h"
#include "error_utils.h"
#include "security_utils.h"
#include "memory_debug.h"
#include <windows.h>

namespace FSMeta {

namespace {

// RAII wrapper for file attributes
class FileAttributeHandler {
  const std::wstring &path;
  DWORD attributes;

public:
  explicit FileAttributeHandler(const std::wstring &p)
      : path(p), attributes(GetFileAttributesW(p.c_str())) {
    if (attributes == INVALID_FILE_ATTRIBUTES) {
      throw FSException("GetFileAttributes", GetLastError());
    }
  }

  bool isHidden() const { return (attributes & FILE_ATTRIBUTE_HIDDEN) != 0; }

  void setHidden(bool value) {
    DWORD newAttrs = value ? (attributes | FILE_ATTRIBUTE_HIDDEN)
                           : (attributes & ~FILE_ATTRIBUTE_HIDDEN);

    if (!SetFileAttributesW(path.c_str(), newAttrs)) {
      throw FSException("SetFileAttributes", GetLastError());
    }
    attributes = newAttrs;
  }
};
} // anonymous namespace

class GetHiddenWorker : public Napi::AsyncWorker {
  const std::string path;
  bool result = false;
  Napi::Promise::Deferred deferred;

public:
  GetHiddenWorker(Napi::Env env, std::string p, Napi::Promise::Deferred def)
      : Napi::AsyncWorker(env), path(std::move(p)), result(false), deferred(def) {}

  void Execute() override {
    try {
      MEMORY_CHECKPOINT("GetHiddenWorker::Execute");
      
      // Debug: Log the input path
      DEBUG_LOG("[GetHiddenWorker] Checking path: %s", path.c_str());
      
      // Enhanced security validation
      if (!SecurityUtils::IsPathSecure(path)) {
        DEBUG_LOG("[GetHiddenWorker] Path failed security check: %s", path.c_str());
        throw FSException("Security validation failed: invalid path",
                          ERROR_INVALID_PARAMETER);
      }
      
      DEBUG_LOG("[GetHiddenWorker] Path passed security check");

      auto wpath = SecurityUtils::SafeStringToWide(path);
      DEBUG_LOG("[GetHiddenWorker] Converted to wide string");
      
      // Check if file exists before checking attributes
      DWORD attributes = GetFileAttributesW(wpath.c_str());
      if (attributes == INVALID_FILE_ATTRIBUTES) {
        DWORD error = GetLastError();
        if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) {
          DEBUG_LOG("[GetHiddenWorker] File not found: %s", path.c_str());
          result = false;  // Non-existent files are not hidden
          return;
        }
        // Other errors should throw
        throw FSException("GetFileAttributes", error);
      }
      
      // Check if it's a root directory
      bool isRoot = (wpath.length() == 3 && wpath[1] == L':' && wpath[2] == L'\\');
      if (isRoot) {
        DEBUG_LOG("[GetHiddenWorker] Root directory detected: %s, attributes: 0x%X", path.c_str(), attributes);
        // Windows may report root directories as hidden/system, but we'll report the actual state
        // The tests will need to be updated to reflect actual Windows behavior
      }
      
      result = (attributes & FILE_ATTRIBUTE_HIDDEN) != 0;
      DEBUG_LOG("[GetHiddenWorker] Result: %s", result ? "hidden" : "not hidden");
    } catch (const FSException &e) {
      DEBUG_LOG("[GetHiddenWorker] Caught FSException: %s", e.what());
      SetError(e.what());
    } catch (const std::exception &e) {
      DEBUG_LOG("[GetHiddenWorker] Caught std::exception: %s", e.what());
      SetError(std::string("Unexpected error: ") + e.what());
    }
  }

  void OnOK() override {
    DEBUG_LOG("[GetHiddenWorker] OnOK called, result=%s", result ? "true" : "false");
    Napi::HandleScope scope(Env());
    deferred.Resolve(Napi::Boolean::New(Env(), result));
  }

  void OnError(const Napi::Error &e) override {
    DEBUG_LOG("[GetHiddenWorker] OnError called with: %s", e.Message().c_str());
    Napi::HandleScope scope(Env());
    deferred.Reject(e.Value());
  }
};

class SetHiddenWorker : public Napi::AsyncWorker {
  const std::string path;
  const bool value;
  Napi::Promise::Deferred deferred;

public:
  SetHiddenWorker(Napi::Env env, std::string p, bool v,
                  Napi::Promise::Deferred def)
      : Napi::AsyncWorker(env), path(std::move(p)), value(v), deferred(def) {}

  void Execute() override {
    try {
      MEMORY_CHECKPOINT("SetHiddenWorker::Execute");
      
      // Enhanced security validation
      if (!SecurityUtils::IsPathSecure(path)) {
        throw FSException("Security validation failed: invalid path",
                          ERROR_INVALID_PARAMETER);
      }

      auto wpath = SecurityUtils::SafeStringToWide(path);
      FileAttributeHandler handler(wpath);
      handler.setHidden(value);
    } catch (const FSException &e) {
      SetError(e.what());
    } catch (const std::exception &e) {
      SetError(std::string("Unexpected error: ") + e.what());
    }
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    deferred.Resolve(Napi::Boolean::New(Env(), true));
  }

  void OnError(const Napi::Error &e) override {
    Napi::HandleScope scope(Env());
    deferred.Reject(e.Value());
  }
};

Napi::Promise GetHiddenAttribute(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);

  try {
    if (info.Length() < 1 || !info[0].IsString()) {
      throw Napi::TypeError::New(env, "String path expected");
    }

    std::string path = info[0].As<Napi::String>();
    auto *worker = new GetHiddenWorker(env, std::move(path), deferred);
    worker->Queue();

    return deferred.Promise();
  } catch (const Napi::Error &e) {
    deferred.Reject(e.Value());
    return deferred.Promise();
  }
}

Napi::Promise SetHiddenAttribute(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);

  try {
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsBoolean()) {
      throw Napi::TypeError::New(env, "String path and boolean value expected");
    }

    std::string path = info[0].As<Napi::String>();
    bool value = info[1].As<Napi::Boolean>();

    auto *worker = new SetHiddenWorker(env, std::move(path), value, deferred);
    worker->Queue();

    return deferred.Promise();
  } catch (const Napi::Error &e) {
    deferred.Reject(e.Value());
    return deferred.Promise();
  }
}

} // namespace FSMeta