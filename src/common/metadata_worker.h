// src/common/metadata_worker.h
#pragma once
#include "volume_metadata.h"
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

    result.Set("fileSystem", metadata.fileSystem);
    result.Set("label", metadata.label);
    result.Set("uuid", metadata.uuid);
    result.Set("status", metadata.status);
    result.Set("mountFrom", metadata.mountFrom);
    result.Set("remoteHost", metadata.remoteHost);
    result.Set("remoteShare", metadata.remoteShare);
    result.Set("uri", metadata.uri);
    result.Set("size", metadata.size);
    result.Set("used", metadata.used);
    result.Set("available", metadata.available);
    result.Set("ok", metadata.ok);
    result.Set("remote", metadata.remote);

    return result;
  }
};

} // namespace FSMeta