// src/darwin/hidden.cpp
#include "hidden.h"
#include "../common/debug_log.h"
#include <sys/stat.h>
#include <unistd.h>

namespace FSMeta {

GetHiddenWorker::GetHiddenWorker(std::string path,
                                 Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(deferred.Env()), path_(path), deferred_(deferred),
      is_hidden_(false) {
  DEBUG_LOG("[GetHiddenWorker] created for path: %s", path_.c_str());
}

void GetHiddenWorker::Execute() {
  DEBUG_LOG("[GetHiddenWorker] checking hidden status for: %s", path_.c_str());

  // Add path validation to prevent directory traversal
  if (path_.find("..") != std::string::npos) {
    SetError("Invalid path containing '..'");
    return;
  }

  struct stat statbuf;
  if (stat(path_.c_str(), &statbuf) != 0) {
    int error = errno;
    if (error == ENOENT) {
      DEBUG_LOG("[GetHiddenWorker] path not found: %s", path_.c_str());
      SetError("Path not found");
    } else {
      DEBUG_LOG("[GetHiddenWorker] failed to stat path %s: %s (%d)",
                path_.c_str(), strerror(error), error);
      SetError(std::string("Failed to stat path: ") + strerror(error));
    }
    return;
  }
  is_hidden_ = (statbuf.st_flags & UF_HIDDEN) != 0;
  DEBUG_LOG("[GetHiddenWorker] path %s is %s", path_.c_str(),
            is_hidden_ ? "hidden" : "not hidden");
}

void GetHiddenWorker::OnOK() {
  auto env = Env();
  deferred_.Resolve(Napi::Boolean::New(env, is_hidden_));
}

void GetHiddenWorker::OnError(const Napi::Error &error) {
  deferred_.Reject(error.Value());
}

Napi::Promise GetHiddenAttribute(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  DEBUG_LOG("[GetHiddenAttribute] called");

  if (info.Length() < 1 || !info[0].IsString()) {
    DEBUG_LOG("[GetHiddenAttribute] invalid arguments");
    auto error = Napi::Error::New(env, "String path expected");
    auto deferred = Napi::Promise::Deferred::New(env);
    deferred.Reject(error.Value());
    return deferred.Promise();
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  DEBUG_LOG("[GetHiddenAttribute] getting hidden status for: %s", path.c_str());
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GetHiddenWorker(path, deferred);
  worker->Queue();
  return deferred.Promise();
}

SetHiddenWorker::SetHiddenWorker(std::string path, bool hidden,
                                 Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(deferred.Env()), path_(path), hidden_(hidden),
      deferred_(deferred) {
  DEBUG_LOG("[SetHiddenWorker] created for path: %s, hidden: %d", path_.c_str(),
            hidden_);
}

void SetHiddenWorker::Execute() {
  DEBUG_LOG("[SetHiddenWorker] setting hidden=%d for: %s", hidden_,
            path_.c_str());

  // Add path validation to prevent directory traversal
  if (path_.find("..") != std::string::npos) {
    SetError("Invalid path containing '..'");
    return;
  }

  struct stat statbuf;
  if (stat(path_.c_str(), &statbuf) != 0) {
    int error = errno;
    if (error == ENOENT) {
      DEBUG_LOG("[SetHiddenWorker] path not found: %s", path_.c_str());
      SetError("Path not found");
    } else {
      DEBUG_LOG("[SetHiddenWorker] failed to stat path %s: %s (%d)",
                path_.c_str(), strerror(error), error);
      SetError(std::string("Failed to stat path: ") + strerror(error));
    }
    return;
  }

  u_int32_t new_flags;
  if (hidden_) {
    new_flags = statbuf.st_flags | UF_HIDDEN;
  } else {
    new_flags = statbuf.st_flags & ~UF_HIDDEN;
  }

  if (chflags(path_.c_str(), new_flags) != 0) {
    DEBUG_LOG("[SetHiddenWorker] failed to set flags for: %s", path_.c_str());
    SetError("Failed to set flags");
    return;
  }
  DEBUG_LOG("[SetHiddenWorker] successfully set hidden=%d for: %s", hidden_,
            path_.c_str());
}

void SetHiddenWorker::OnOK() {
  auto env = Env();
  deferred_.Resolve(env.Undefined());
}

void SetHiddenWorker::OnError(const Napi::Error &error) {
  deferred_.Reject(error.Value());
}

Napi::Promise SetHiddenAttribute(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  DEBUG_LOG("[SetHiddenAttribute] called");

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsBoolean()) {
    DEBUG_LOG("[SetHiddenAttribute] invalid arguments");
    auto error = Napi::Error::New(
        env, "Expected arguments: (string path, boolean hidden)");
    auto deferred = Napi::Promise::Deferred::New(env);
    deferred.Reject(error.Value());
    return deferred.Promise();
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  bool hidden = info[1].As<Napi::Boolean>().Value();
  DEBUG_LOG("[SetHiddenAttribute] setting hidden=%d for: %s", hidden,
            path.c_str());

  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new SetHiddenWorker(path, hidden, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta