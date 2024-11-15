// src/linux/gio_utils.h
#pragma once

#ifdef ENABLE_GIO

#include "fs_meta.h"
#include <string>
#include <vector>

namespace FSMeta {
namespace gio {

void addMountMetadata(const std::string &mountPoint, VolumeMetadata &metadata);
std::vector<TypedMountPoint> getMountPoints();

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO