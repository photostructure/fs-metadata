// src/linux/fs_meta.h
#pragma once
#include <napi.h>
#include <string>
#include <vector>

namespace FSMeta {

class GetVolumeMetadataWorker : public Napi::AsyncWorker {
public:
  GetVolumeMetadataWorker(const std::string& path, const Napi::Promise::Deferred& deferred);
  void Execute() override;
  void OnOK() override;

private:
  struct VolumeMetadata {
    std::string filesystem;
    std::string label;
    std::string uuid;
    std::string remoteHost;
    std::string remoteShare;
    uint64_t size;
    uint64_t used;
    uint64_t available;
    dev_t dev;
    bool remote;
    bool ok;
    std::string status;
  };

  std::string mountpoint;
  VolumeMetadata metadata;
  Napi::Promise::Deferred deferred_;
};

Napi::Value GetVolumeMetadata(Napi::Env env, const std::string& mountpoint);

} // namespace FSMeta