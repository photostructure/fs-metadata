// src/binding.cpp
#include <napi.h>
#include <string>

#include "common/debug_log.h"
#if defined(_WIN32)
#include "windows/fs_meta.h"
#include "windows/hidden.h"
#elif defined(__APPLE__)
#include "darwin/fs_meta.h"
#include "darwin/hidden.h"
#elif defined(__linux__)
#include "common/volume_metadata.h"
#ifdef ENABLE_GIO
#include "linux/gio_mount_points.h"
#include "linux/gio_volume_metadata.h"
#endif
#endif

namespace {

Napi::Value SetDebugLogging(const Napi::CallbackInfo &info) {
  const Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBoolean()) {
    throw Napi::TypeError::New(env, "Boolean argument expected");
  }

  FSMeta::Debug::enableDebugLogging = info[0].As<Napi::Boolean>();
  return env.Undefined();
}

Napi::Value SetDebugPrefix(const Napi::CallbackInfo &info) {
  const Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    throw Napi::TypeError::New(env, "String argument expected");
  }

  // Set the debug prefix directly
  FSMeta::Debug::SetDebugPrefix(info[0].As<Napi::String>().Utf8Value());
  return env.Undefined();
}

#ifdef ENABLE_GIO
Napi::Value GetGioMountPoints(const Napi::CallbackInfo &info) {
  const Napi::Env env = info.Env();
  return FSMeta::gio::GetMountPoints(env);
}
#endif

#if defined(_WIN32) || defined(__APPLE__)
// Fix: Remove extra parameter and use correct signature
Napi::Value GetVolumeMountPoints(const Napi::CallbackInfo &info) {
  return FSMeta::GetVolumeMountPoints(info);
}
#endif

Napi::Value GetVolumeMetadata(const Napi::CallbackInfo &info) {
  return FSMeta::GetVolumeMetadata(info);
}

#if defined(_WIN32) || defined(__APPLE__)
Napi::Value GetHiddenAttribute(const Napi::CallbackInfo &info) {
  return FSMeta::GetHiddenAttribute(info);
}

Napi::Value SetHiddenAttribute(const Napi::CallbackInfo &info) {
  return FSMeta::SetHiddenAttribute(info);
}
#endif

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setDebugLogging", Napi::Function::New(env, SetDebugLogging));
  exports.Set("setDebugPrefix", Napi::Function::New(env, SetDebugPrefix));

#if defined(_WIN32) || defined(__APPLE__)
  exports.Set("getVolumeMountPoints",
              Napi::Function::New(env, GetVolumeMountPoints));
#endif

  exports.Set("getVolumeMetadata", Napi::Function::New(env, GetVolumeMetadata));

#ifdef ENABLE_GIO
  exports.Set("getGioMountPoints", Napi::Function::New(env, GetGioMountPoints));
#endif

#if defined(_WIN32) || defined(__APPLE__)
  exports.Set("isHidden", Napi::Function::New(env, GetHiddenAttribute));
  exports.Set("setHidden", Napi::Function::New(env, SetHiddenAttribute));
#endif

  return exports;
}

NODE_API_MODULE(node_fs_meta, Init)

} // namespace