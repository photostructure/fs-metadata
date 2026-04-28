// src/common/metadata_worker.h
#pragma once
#include "./shutdown.h"
#include "./volume_metadata.h"
#include <napi.h>

namespace FSMeta {

class MetadataWorkerBase : public SafeAsyncWorker {
protected:
  std::string mountPoint;
  VolumeMetadata metadata;
  Napi::Promise::Deferred deferred_;

  MetadataWorkerBase(const std::string &path,
                     const Napi::Promise::Deferred &deferred)
      : SafeAsyncWorker(deferred.Env()), mountPoint(path), deferred_(deferred) {}

  void OnError(const Napi::Error &error) override {
    Napi::HandleScope scope(Env());
    SafeReject(deferred_, error.Value());
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    SafeResolve(deferred_, metadata.ToObject(Env()));
  }
}; // class MetadataWorkerBase

} // namespace FSMeta
