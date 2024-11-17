// src/linux/fs_meta.h
#pragma once

#include <napi.h>
#include <string>
#include <vector>

namespace FSMeta {

struct VolumeMetadata {
  std::string fileSystem;
  std::string label;
  std::string uuid;
  std::string status;
  std::string remoteHost;
  std::string remoteShare;
  std::string uri;
  double size;
  double used;
  double available;
  bool ok = true;
  bool remote = false;
};

struct VolumeMetadataOptions {
  uint32_t timeoutMs;
  std::string device;
};

class GetVolumeMetadataWorker : public Napi::AsyncWorker {
public:
  GetVolumeMetadataWorker(const std::string &path,
                          const VolumeMetadataOptions &options,
                          const Napi::Promise::Deferred &deferred)
      : Napi::AsyncWorker(deferred.Env()), mountPoint(path), options_(options),
        deferred_(deferred) {}

  void Execute() override;
  void OnOK() override;
  void OnError(const Napi::Error &error) override {
    deferred_.Reject(error.Value());
  }

private:
  std::string mountPoint;
  VolumeMetadataOptions options_;
  Napi::Promise::Deferred deferred_;
  VolumeMetadata metadata;
};

Napi::Value GetVolumeMetadata(const Napi::Env &env,
                              const std::string &mountPoint,
                              const Napi::Object &options);

} // namespace FSMeta