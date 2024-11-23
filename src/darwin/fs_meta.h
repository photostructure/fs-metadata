// src/darwin/fs_meta.h

#pragma once

#include "../common/error_utils.h"
#include "../common/metadata_worker.h"
#include "../common/mount_point.h"
#include "../common/volume_mount_points.h"

namespace FSMeta {

// Forward declarations of the main interface functions
Napi::Value GetVolumeMountPoints(Napi::Env env);
Napi::Value GetVolumeMetadata(const Napi::Env &env,
                              const std::string &mountPoint,
                              const Napi::Object &options);

} // namespace FSMeta