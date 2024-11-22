// src/windows/fs_meta.h
#pragma once
#include "../common/volume_metadata.h"
#include "../common/volume_mount_points.h"
#include "./error_utils.h"
#include <napi.h>

#include <string>

namespace FSMeta {

constexpr size_t ERROR_BUFFER_SIZE = 256;
constexpr DWORD BUFFER_SIZE = MAX_PATH + 1;

} // namespace FSMeta