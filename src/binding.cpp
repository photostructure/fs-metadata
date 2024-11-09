// src/binding.cpp
#include <napi.h>

#ifdef _WIN32
#include "windows/fs_meta.h"
#elif __APPLE__
#include "darwin/fs_meta.h"
#else
#include "linux/fs_meta.h"
#endif

#if defined(_WIN32) || defined(__APPLE__)
Napi::Value GetMountpoints(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return FSMeta::GetMountpoints(env);
}
#endif

Napi::Value GetVolumeMetadata(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "String argument expected").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string mountpoint = info[0].As<Napi::String>().Utf8Value();
  return FSMeta::GetVolumeMetadata(env, mountpoint);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  #if defined(_WIN32) || defined(__APPLE__)
  exports.Set("getMountpoints", 
    Napi::Function::New(env, GetMountpoints));
  #endif
  
  exports.Set("getVolumeMetadata", 
    Napi::Function::New(env, GetVolumeMetadata));
  return exports;
}

NODE_API_MODULE(node_fs_meta, Init)