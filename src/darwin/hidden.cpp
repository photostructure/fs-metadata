// src/darwin/hidden.cpp
#include "hidden.h"
#include <sys/stat.h>
#include <unistd.h>

namespace FSMeta {

GetHiddenWorker::GetHiddenWorker(std::string path,
                                 Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(deferred.Env()), path_(path), deferred_(deferred),
      is_hidden_(false) {}

void GetHiddenWorker::Execute() {
  struct stat statbuf;
  if (lstat(path_.c_str(), &statbuf) != 0) {
    SetError("Failed to stat path");
    return;
  }
  is_hidden_ = (statbuf.st_flags & UF_HIDDEN) != 0;
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

  if (info.Length() < 1 || !info[0].IsString()) {
    auto error = Napi::Error::New(env, "String path expected");
    auto deferred = Napi::Promise::Deferred::New(env);
    deferred.Reject(error.Value());
    return deferred.Promise();
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GetHiddenWorker(path, deferred);
  worker->Queue();
  return deferred.Promise();
}

SetHiddenWorker::SetHiddenWorker(std::string path, bool hidden,
                                 Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(deferred.Env()), path_(path), hidden_(hidden),
      deferred_(deferred) {}

void SetHiddenWorker::Execute() {
  struct stat statbuf;
  if (lstat(path_.c_str(), &statbuf) != 0) {
    SetError("Failed to stat path");
    return;
  }

  u_int32_t new_flags;
  if (hidden_) {
    new_flags = statbuf.st_flags | UF_HIDDEN;
  } else {
    new_flags = statbuf.st_flags & ~UF_HIDDEN;
  }

  if (chflags(path_.c_str(), new_flags) != 0) {
    SetError("Failed to set flags");
    return;
  }
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

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsBoolean()) {
    auto error = Napi::Error::New(
        env, "Expected arguments: (string path, boolean hidden)");
    auto deferred = Napi::Promise::Deferred::New(env);
    deferred.Reject(error.Value());
    return deferred.Promise();
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  bool hidden = info[1].As<Napi::Boolean>().Value();

  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new SetHiddenWorker(path, hidden, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta