// src/common/volume_mount_points.h
#pragma once
#include <napi.h>
#include <string>

namespace FSMeta {

struct MountPoint {
  std::string mountPoint;
  std::string fstype;
  std::string status;
  bool isSystemVolume = false; // Default to false

  Napi::Object ToObject(Napi::Env env) const {
    auto obj = Napi::Object::New(env);

    obj.Set("mountPoint", mountPoint);
    obj.Set("fstype", fstype);
    obj.Set("status", status);
    obj.Set("isSystemVolume", isSystemVolume);

    return obj;
  }
};

Napi::Promise GetVolumeMountPoints(const Napi::CallbackInfo &info);

} // namespace FSMeta