// src/common/metadata_worker.h
#pragma once
#include "./volume_metadata.h"
#include <napi.h>

namespace FSMeta {

class MetadataWorkerBase : public Napi::AsyncWorker {
protected:
  std::string mountPoint;
  VolumeMetadata metadata;
  Napi::Promise::Deferred deferred_;

  MetadataWorkerBase(const std::string &path,
                     const Napi::Promise::Deferred &deferred)
      : Napi::AsyncWorker(deferred.Env()), mountPoint(path),
        deferred_(deferred) {}

  void OnError(const Napi::Error &error) override {
    deferred_.Reject(error.Value());
  }

  // Creates a JavaScript object from VolumeMetadata
  Napi::Object CreateResultObject() {
    auto env = Env();
    auto result = Napi::Object::New(env);

    // Match the current VolumeMetadata struct members
    result.Set("label", metadata.label.empty()
                            ? env.Null()
                            : Napi::String::New(env, metadata.label));
    result.Set("fileSystem", metadata.fileSystem.empty()
                                 ? env.Null()
                                 : Napi::String::New(env, metadata.fileSystem));
    result.Set("size", Napi::Number::New(env, metadata.size));
    result.Set("used", Napi::Number::New(env, metadata.used));
    result.Set("available", Napi::Number::New(env, metadata.available));
    result.Set("uuid", metadata.uuid.empty()
                           ? env.Null()
                           : Napi::String::New(env, metadata.uuid));
    result.Set("mountFrom", metadata.mountFrom.empty()
                                ? env.Null()
                                : Napi::String::New(env, metadata.mountFrom));
    result.Set("mountName", metadata.mountName.empty()
                                ? env.Null()
                                : Napi::String::New(env, metadata.mountName));
    result.Set("uri", metadata.uri.empty()
                          ? env.Null()
                          : Napi::String::New(env, metadata.uri));
    result.Set("status", Napi::String::New(env, metadata.status));

    if (metadata.remote) {
      result.Set("remote", Napi::Boolean::New(env, metadata.remote));
    }
    result.Set("remoteHost", metadata.remoteHost.empty()
                                 ? env.Null()
                                 : Napi::String::New(env, metadata.remoteHost));
    result.Set("remoteShare",
               metadata.remoteShare.empty()
                   ? env.Null()
                   : Napi::String::New(env, metadata.remoteShare));

    return result;
  };

  void OnOK() override { deferred_.Resolve(CreateResultObject()); }
}; // class MetadataWorkerBase

} // namespace FSMeta