// src/windows/fs_meta.h

#pragma once
#include "../common/volume_metadata.h"
#include "../common/volume_mount_points.h"
#include "windows_arch.h"

namespace FSMeta {

constexpr size_t ERROR_BUFFER_SIZE = 256;
constexpr size_t BUFFER_SIZE = MAX_PATH + 1;

} // namespace FSMeta