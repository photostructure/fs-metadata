// src/windows/fs_meta.h
#pragma once
#include "../common/volume_metadata.h"
#include "../common/volume_mount_points.h"
#include <functional>
#include <napi.h>
#include <utility>
#include <windows.h> // for MAX_PATH

namespace FSMeta {

constexpr size_t ERROR_BUFFER_SIZE = 256;
constexpr size_t BUFFER_SIZE = MAX_PATH + 1;

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

} // namespace FSMeta