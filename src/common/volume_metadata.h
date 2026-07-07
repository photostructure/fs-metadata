// src/common/volume_metadata.h
#pragma once
#include "./volume_utils.h"
#include <cstdint>
#include <napi.h>
#include <string>

namespace FSMeta {
struct VolumeMetadataOptions {
  std::string mountPoint;    // Required mount point path
  uint32_t timeoutMs = 5000; // Optional timeout with default
  std::string device;        // Optional device path
  std::string fstype; // Optional filesystem type (gates btrfs-only probes)
  bool skipNetworkVolumes =
      false; // Skip detailed info for network volumes to avoid blocking

  static VolumeMetadataOptions FromObject(const Napi::Object &obj) {
    VolumeMetadataOptions options;

    // Required mountPoint
    if (!obj.Has("mountPoint") || !obj.Get("mountPoint").IsString()) {
      throw Napi::TypeError::New(obj.Env(), "String expected for mountPoint");
    }
    options.mountPoint = obj.Get("mountPoint").As<Napi::String>();
    if (options.mountPoint.empty()) {
      throw Napi::TypeError::New(obj.Env(), "mountPoint cannot be empty");
    }

    // Optional parameters
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
    if (obj.Has("device")) {
      options.device = obj.Get("device").As<Napi::String>();
    }
    if (obj.Has("fstype") && obj.Get("fstype").IsString()) {
      options.fstype = obj.Get("fstype").As<Napi::String>();
    }
    if (obj.Has("skipNetworkVolumes")) {
      options.skipNetworkVolumes =
          obj.Get("skipNetworkVolumes").As<Napi::Boolean>().Value();
    }

    return options;
  }
};

// Volume metadata structure
struct VolumeMetadata {
  std::string label;
  std::string fstype;
  double size = 0.0;
  double used = 0.0;
  double available = 0.0;
  std::string uuid;
  std::string subvolumeUuid; // btrfs per-subvolume UUID (Linux only)
  std::string fsid;          // statfs f_fsid, hex (Linux; zfs dataset id)
  std::string mountFrom;
  std::string mountName;
  std::string uri;
  std::string status;
  bool remote = false;
  std::string remoteHost;
  std::string remoteShare;
  bool isSystemVolume = false;
  bool isReadOnly = false;
  std::string volumeRole;
  std::string error;

  Napi::Object ToObject(Napi::Env env) const {
    auto result = Napi::Object::New(env);

    // For string fields, check if empty before setting
    if (!label.empty()) {
      result.Set("label", Napi::String::New(env, label));
    } else {
      result.Set("label", env.Null());
    }

    if (!fstype.empty()) {
      result.Set("fstype", Napi::String::New(env, fstype));
    } else {
      result.Set("fstype", env.Null());
    }

    // Numeric fields
    result.Set("size", Napi::Number::New(env, size));
    result.Set("used", Napi::Number::New(env, used));
    result.Set("available", Napi::Number::New(env, available));

    // More string fields
    if (!uuid.empty()) {
      result.Set("uuid", Napi::String::New(env, uuid));
    } else {
      result.Set("uuid", env.Null());
    }

    // Only present on btrfs (and only when the ioctl is available); omitted
    // otherwise so consumers see `undefined`, matching volumeRole's pattern.
    if (!subvolumeUuid.empty()) {
      result.Set("subvolumeUuid", Napi::String::New(env, subvolumeUuid));
    }

    // Only present where f_fsid is a stable identifier (currently zfs); omitted
    // otherwise so consumers see `undefined`.
    if (!fsid.empty()) {
      result.Set("fsid", Napi::String::New(env, fsid));
    }

    if (!mountFrom.empty()) {
      result.Set("mountFrom", Napi::String::New(env, mountFrom));
    } else {
      result.Set("mountFrom", env.Null());
    }

    if (!mountName.empty()) {
      result.Set("mountName", Napi::String::New(env, mountName));
    } else {
      result.Set("mountName", env.Null());
    }

    if (!uri.empty()) {
      result.Set("uri", Napi::String::New(env, uri));
    } else {
      result.Set("uri", env.Null());
    }

    result.Set("status", Napi::String::New(env, status));

    // Boolean and conditional fields
    if (remote) {
      result.Set("remote", Napi::Boolean::New(env, remote));
    }

    if (!remoteHost.empty()) {
      result.Set("remoteHost", Napi::String::New(env, remoteHost));
    } else {
      result.Set("remoteHost", env.Null());
    }

    if (!remoteShare.empty()) {
      result.Set("remoteShare", Napi::String::New(env, remoteShare));
    } else {
      result.Set("remoteShare", env.Null());
    }

    result.Set("isSystemVolume", Napi::Boolean::New(env, isSystemVolume));
    result.Set("isReadOnly", Napi::Boolean::New(env, isReadOnly));

    if (!volumeRole.empty()) {
      result.Set("volumeRole", Napi::String::New(env, volumeRole));
    }

    return result;
  }
};

Napi::Value GetVolumeMetadata(const Napi::CallbackInfo &info);

} // namespace FSMeta