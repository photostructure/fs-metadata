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

  void OnOK() override { deferred_.Resolve(metadata.ToObject(Env())); }
}; // class MetadataWorkerBase

} // namespace FSMeta