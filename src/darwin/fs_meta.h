// src/darwin/fs_meta.h

#pragma once
#include <napi.h>

#include <string>

namespace FSMeta {
Napi::Value GetVolumeMountPoints(Napi::Env env);
Napi::Value GetVolumeMetadata(const Napi::Env &env, const std::string &path,
                              const Napi::Object &options);
} // namespace FSMeta