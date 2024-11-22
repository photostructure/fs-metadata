// src/common/volume_metadata.h
#pragma once
#include <napi.h>
#include <string>

namespace FSMeta {

// Volume metadata structure
struct VolumeMetadata {
  std::string label;
  std::string fileSystem;
  double size;
  double used;
  double available;
  std::string uuid;
  std::string mountFrom;
  std::string uri;
  std::string status;
  bool remote = false;
  std::string remoteHost;
  std::string remoteShare;
};

struct VolumeMetadataOptions {
  uint32_t timeoutMs = 5000;
  std::string device;
};

Napi::Value GetVolumeMetadata(const Napi::Env &env,
                              const std::string &mountPoint,
                              const Napi::Object &options);

} // namespace FSMeta