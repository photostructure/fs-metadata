// src/common/volume_metadata.h
#pragma once
#include <napi.h>
#include <string>

namespace FSMeta {
struct VolumeMetadataOptions {
  std::string mountPoint;    // Required mount point path
  uint32_t timeoutMs = 5000; // Optional timeout with default
  std::string device;        // Optional device path
  bool skipNetworkVolumes =
      false; // Skip detailed info for network volumes to avoid blocking

  static VolumeMetadataOptions FromObject(const Napi::Object &obj) {
    VolumeMetadataOptions options;

    // Required mountPoint
    if (!obj.Has("mountPoint") || !obj.Get("mountPoint").IsString()) {
      throw Napi::TypeError::New(obj.Env(), "String expected for mountPoint");
    }
    options.mountPoint = obj.Get("mountPoint").As<Napi::String>();

    // Optional parameters
    if (obj.Has("timeoutMs")) {
      options.timeoutMs = obj.Get("timeoutMs").As<Napi::Number>().Uint32Value();
    }
    if (obj.Has("device")) {
      options.device = obj.Get("device").As<Napi::String>();
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
  double size;
  double used;
  double available;
  std::string uuid;
  std::string mountFrom;
  std::string mountName;
  std::string uri;
  std::string status;
  bool remote = false;
  std::string remoteHost;
  std::string remoteShare;
  bool isSystemVolume = false;
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

    return result;
  }
};

Napi::Value GetVolumeMetadata(const Napi::CallbackInfo &info);

} // namespace FSMeta