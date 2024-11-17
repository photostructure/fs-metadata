// src/linux/typed_mount_point.h
#pragma once

#include <string>

namespace FSMeta {

struct TypedMountPoint {
  std::string mountPoint;
  std::string fstype;
};

} // namespace FSMeta