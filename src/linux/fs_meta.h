// src/linux/fs_meta.h
#pragma once

#include <napi.h>
#include <string>
#include <vector>

namespace FSMeta {

struct TypedMountPoint {
  std::string mountPoint;
  std::string fstype;
};

struct VolumeMetadata {
  double size;
  double used;
  double available;
  std::string label;
  std::string uuid;
  std::string status;
  bool ok = true;
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
  void OnError(const Napi::Error &error) override;

private:
  std::string mountPoint;
  VolumeMetadataOptions options_;
  Napi::Promise::Deferred deferred_;
  VolumeMetadata metadata;
};

#ifdef ENABLE_GIO
std::vector<TypedMountPoint> getGioMountPoints();
#endif

VolumeMetadataOptions parseOptions(const Napi::Object &options);

Napi::Value GetVolumeMetadata(Napi::Env env, const std::string &mountPoint,
                             const Napi::Object &options);

} // namespace FSMeta