// src/linux/gio_utils.h
#pragma once

#ifdef ENABLE_GIO

#include "../common/volume_metadata.h"
#include <gio/gio.h>
#include <napi.h>
#include <string>
#include <vector>

// Custom deleter for GObject types using g_object_unref
template <typename T> struct GObjectDeleter {
  void operator()(T *ptr) const {
    if (ptr) {
      g_object_unref(ptr);
    }
  }
};

// Custom deleter for g_free
struct GFreeDeleter {
  void operator()(void *ptr) const {
    if (ptr) {
      g_free(ptr);
    }
  }
};

// Smart pointer aliases
template <typename T> using GObjectPtr = std::unique_ptr<T, GObjectDeleter<T>>;

using GCharPtr = std::unique_ptr<char, GFreeDeleter>;

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