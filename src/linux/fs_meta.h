// src/linux/fs_meta.h
#pragma once
#include <napi.h>
#include <string>

namespace FSMeta {

class GetVolumeMetadataWorker : public Napi::AsyncWorker {
public:
  GetVolumeMetadataWorker(const std::string &path,
                          const Napi::Promise::Deferred &deferred);
  void Execute() override;
  void OnOK() override;

private:
  std::string mountPoint;
  Napi::Promise::Deferred deferred_;
  struct {
    std::string fileSystem;
    std::string label;
    std::string uuid;
    std::string remoteHost;
    std::string remoteShare;
    std::string status;
    double size;
    double used;
    double available;
    bool remote = false;
    bool ok = true;
  } metadata;
};

Napi::Value GetVolumeMetadata(Napi::Env env, const std::string &mountPoint);

} // namespace FSMeta