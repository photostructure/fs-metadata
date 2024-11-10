// src/darwin/fs_meta.h

#pragma once
#include <napi.h>

#include <string>

namespace FSMeta {
Napi::Value GetVolumeMountPoints(Napi::Env env);
Napi::Value GetVolumeMetadata(Napi::Env env, const std::string &mountPoint);
} // namespace FSMeta