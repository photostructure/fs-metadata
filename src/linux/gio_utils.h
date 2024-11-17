// src/linux/gio_utils.h
#pragma once

#ifdef ENABLE_GIO

#include "fs_meta.h"
#include "typed_mount_point.h"
#include <napi.h>
#include <string>
#include <vector>

namespace FSMeta {
namespace gio {

/**
 * Get mount points asynchronously using GIO
 */
Napi::Value GetMountPoints(Napi::Env env);

/**
 * Add metadata from GIO to the volume metadata
 */
void addMountMetadata(const std::string &mountPoint, VolumeMetadata &metadata);

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO