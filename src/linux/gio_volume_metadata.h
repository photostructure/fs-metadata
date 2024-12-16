// src/linux/gio_volume_metadata.h

#pragma once

#ifdef ENABLE_GIO

#include "../common/volume_metadata.h"
#include <string>

namespace FSMeta {
namespace gio {
/**
 * Add metadata from GIO to the volume metadata
 */
void addMountMetadata(const std::string &mountPoint, VolumeMetadata &metadata);

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO