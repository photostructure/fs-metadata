// src/common/mount_point.h
#pragma once
#include <napi.h>
#include <string>

namespace FSMeta {

struct MountPoint {
  std::string mountPoint;
  std::string fstype;
};

} // namespace FSMeta