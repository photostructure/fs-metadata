// src/windows/fs_meta.h
#pragma once
#include <napi.h>

#include <string>

namespace FSMeta {
Napi::Value GetMountpoints(Napi::Env env);
Napi::Value GetVolumeMetadata(Napi::Env env, const std::string &mountpoint);
} // namespace FSMeta