// src/common/volume_metadata.h
#pragma once
#include <napi.h>
#include <string>

namespace FSMeta {

struct VolumeMetadata {
  std::string fileSystem;
  std::string label;
  std::string uuid;
  std::string status;
  std::string mountFrom;
  std::string remoteHost;
  std::string remoteShare;
  std::string uri;
  double size = 0;
  double used = 0;
  double available = 0;
  bool ok = true;
  bool remote = false;
};

struct VolumeMetadataOptions {
  uint32_t timeoutMs = 5000;
  std::string device;
};

Napi::Value GetVolumeMetadata(const Napi::Env &env,
                              const std::string &mountPoint,
                              const Napi::Object &options);

} // namespace FSMeta