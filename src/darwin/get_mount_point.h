// src/darwin/get_mount_point.h
// Lightweight mount point lookup using fstatfs() only.
// Returns f_mntonname without DiskArbitration, IOKit, or space calculations.

#pragma once

#include <napi.h>

namespace FSMeta {

Napi::Value GetMountPoint(const Napi::CallbackInfo &info);

} // namespace FSMeta
