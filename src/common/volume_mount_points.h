// src/common/volume_mount_points.h
#pragma once
#include <napi.h>
#include <string>

namespace FSMeta {

struct MountPointOptions {
  uint32_t timeoutMs = 5000; // Default 5 second timeout

  // Add static helper to parse from JS object
  static MountPointOptions FromObject(const Napi::Object &obj) {
    MountPointOptions options;
    if (obj.Has("timeoutMs")) {
      options.timeoutMs = obj.Get("timeoutMs").As<Napi::Number>().Uint32Value();
    }
    return options;
  }
};

struct MountPoint {
  std::string mountPoint;
  std::string fstype;
  std::string status;
  bool isSystemVolume = false; // Default to false
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
    obj.Set("error", error);
    return obj;
  }
};

Napi::Promise GetVolumeMountPoints(const Napi::CallbackInfo &info);

} // namespace FSMeta