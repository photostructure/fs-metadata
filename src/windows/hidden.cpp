// src/windows/hidden.cpp
#include "hidden.h"
#include "error_utils.h"
#include <windows.h>

namespace FSMeta {

namespace {
// Utility class for path conversion
class PathConverter {
public:
  static std::wstring ToWString(const std::string &path) {
    if (path.empty()) {
      return std::wstring();
    }

    // Pre-calculate required buffer size
    int wlen = MultiByteToWideChar(CP_UTF8, 0, path.c_str(),
                                   static_cast<int>(path.length()), nullptr, 0);
    if (wlen == 0) {
      throw FSException("Path conversion", GetLastError());
    }

    // Reserve exact size needed
    std::wstring wpath(wlen, 0);
    if (!MultiByteToWideChar(CP_UTF8, 0, path.c_str(),
                             static_cast<int>(path.length()), &wpath[0],
                             wlen)) {
      throw FSException("Path conversion", GetLastError());
    }
    return wpath;
  }
};

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
  bool result;
  Napi::Promise::Deferred deferred;

public:
  GetHiddenWorker(Napi::Env env, std::string p, Napi::Promise::Deferred def)
      : Napi::AsyncWorker(env), path(std::move(p)), deferred(std::move(def)) {}

  void Execute() override {
    try {
      // Add path validation to prevent directory traversal
      if (path.find("..") != std::string::npos) {
        throw FSException("Invalid path containing '..'",
                          ERROR_INVALID_PARAMETER);
      }

      auto wpath = PathConverter::ToWString(path);
      FileAttributeHandler handler(wpath);
      result = handler.isHidden();
    } catch (const FSException &e) {
      SetError(e.what());
    } catch (const std::exception &e) {
      SetError(std::string("Unexpected error: ") + e.what());
    }
  }

  void OnOK() override { deferred.Resolve(Napi::Boolean::New(Env(), result)); }

  void OnError(const Napi::Error &e) override { deferred.Reject(e.Value()); }
};

class SetHiddenWorker : public Napi::AsyncWorker {
  const std::string path;
  const bool value;
  Napi::Promise::Deferred deferred;

public:
  SetHiddenWorker(Napi::Env env, std::string p, bool v,
                  Napi::Promise::Deferred def)
      : Napi::AsyncWorker(env), path(std::move(p)), value(v),
        deferred(std::move(def)) {}

  void Execute() override {
    try {
      // Add path validation to prevent directory traversal
      if (path.find("..") != std::string::npos) {
        throw FSException("Invalid path containing '..'",
                          ERROR_INVALID_PARAMETER);
      }

      auto wpath = PathConverter::ToWString(path);
      FileAttributeHandler handler(wpath);
      handler.setHidden(value);
    } catch (const FSException &e) {
      SetError(e.what());
    } catch (const std::exception &e) {
      SetError(std::string("Unexpected error: ") + e.what());
    }
  }

  void OnOK() override { deferred.Resolve(Napi::Boolean::New(Env(), true)); }

  void OnError(const Napi::Error &e) override { deferred.Reject(e.Value()); }
};

Napi::Promise GetHiddenAttribute(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);

  try {
    if (info.Length() < 1 || !info[0].IsString()) {
      throw Napi::TypeError::New(env, "String path expected");
    }

    std::string path = info[0].As<Napi::String>();
    auto *worker =
        new GetHiddenWorker(env, std::move(path), std::move(deferred));
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

    auto *worker =
        new SetHiddenWorker(env, std::move(path), value, std::move(deferred));
    worker->Queue();

    return deferred.Promise();
  } catch (const Napi::Error &e) {
    deferred.Reject(e.Value());
    return deferred.Promise();
  }
}

} // namespace FSMeta