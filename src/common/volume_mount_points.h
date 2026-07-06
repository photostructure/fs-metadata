// src/common/volume_mount_points.h
#pragma once
#include "./volume_utils.h"
#include <cstdint>
#include <napi.h>
#include <string>

namespace FSMeta {

struct MountPointOptions {
  uint32_t timeoutMs = 5000; // Default 5 second timeout

  // Add static helper to parse from JS object
  static MountPointOptions FromObject(const Napi::Object &obj) {
    MountPointOptions options;
    if (obj.Has("timeoutMs")) {
      // Uint32Value() would wrap negative values into ~50-day timeouts;
      // reject out-of-range values instead. The !(x >= 0) form also catches
      // NaN. 0 is valid and disables the timeout.
      const double timeoutMs =
          obj.Get("timeoutMs").As<Napi::Number>().DoubleValue();
      if (!(timeoutMs >= 0) || timeoutMs > MAX_TIMEOUT_MS) {
        throw Napi::TypeError::New(
            obj.Env(), "timeoutMs must be between 0 and 86400000 (one day)");
      }
      options.timeoutMs = static_cast<uint32_t>(timeoutMs);
    }
    return options;
  }
};

struct MountPoint {
  std::string mountPoint;
  std::string fstype;
  std::string status;
  bool isSystemVolume = false;
  bool isReadOnly = false;
  std::string volumeRole;
  std::string error;

  Napi::Object ToObject(Napi::Env env) const {
    auto obj = Napi::Object::New(env);

    if (!mountPoint.empty()) {
      obj.Set("mountPoint", mountPoint);
    }
    if (!fstype.empty()) {
      obj.Set("fstype", fstype);
    }
    if (!status.empty()) {
      obj.Set("status", status);
    }
    obj.Set("isSystemVolume", isSystemVolume);
    obj.Set("isReadOnly", isReadOnly);
    if (!volumeRole.empty()) {
      obj.Set("volumeRole", volumeRole);
    }
    obj.Set("error", error);
    return obj;
  }
};

Napi::Promise GetVolumeMountPoints(const Napi::CallbackInfo &info);

} // namespace FSMeta