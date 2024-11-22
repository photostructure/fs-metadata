// src/common/volume_mount_points.h
#pragma once
#include <napi.h>
#include <string>

namespace FSMeta {
Napi::Value GetVolumeMountPoints(Napi::Env env);
}