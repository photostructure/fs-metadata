// src/common/volume_metadata.h
#pragma once
#include <napi.h>
#include <string>

namespace FSMeta {

enum DriveStatus {
  Unknown,
  Unavailable,
  Healthy,
  Disconnected,
  Error,
  NoMedia
};

inline const char *DriveStatusToString(DriveStatus status) {
  switch (status) {
  case Unknown:
    return "unknown";
  case Unavailable:
    return "unavailable";
  case Healthy:
    return "healthy";
  case Disconnected:
    return "disconnected";
  case Error:
    return "error";
  case NoMedia:
    return "no_media";
  default:
    return "unknown";
  }
}

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
  DriveStatus status;
  bool remote;
  std::string remoteHost;
  std::string remoteShare;
};

// struct VolumeMetadata
// {
//   std::string fileSystem;
//   std::string label;
//   std::string uuid;
//   std::string status;
//   std::string mountFrom;
//   std::string remoteHost;
//   std::string remoteShare;
//   std::string uri;
//   double size = 0;
//   double used = 0;
//   double available = 0;
//   bool ok = true;
//   bool remote = false;
// };

struct VolumeMetadataOptions {
  uint32_t timeoutMs = 5000;
  std::string device;
};

Napi::Value GetVolumeMetadata(const Napi::Env &env,
                              const std::string &mountPoint,
                              const Napi::Object &options);

} // namespace FSMeta