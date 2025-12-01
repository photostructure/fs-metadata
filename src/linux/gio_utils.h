// src/linux/gio_utils.h
#pragma once

#ifdef ENABLE_GIO

#include <gio/gio.h>
#include <gio/gunixmounts.h>
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

// Custom deleter for g_free (used for strings from GIO APIs like
// g_file_get_path)
struct GFreeDeleter {
  void operator()(void *ptr) const {
    if (ptr) {
      g_free(ptr);
    }
  }
};

// Smart pointer aliases for RAII management of GIO resources
// These ensure proper cleanup even when exceptions occur
template <typename T> using GObjectPtr = std::unique_ptr<T, GObjectDeleter<T>>;

// Common GIO object types
using GFilePtr = GObjectPtr<GFile>;
using GMountPtr = GObjectPtr<GMount>;
using GVolumePtr = GObjectPtr<GVolume>;
using GVolumeMonitorPtr = GObjectPtr<GVolumeMonitor>;
using GFileInfoPtr = GObjectPtr<GFileInfo>;

// For strings allocated by GIO (g_file_get_path, g_file_get_uri, etc.)
using GCharPtr = std::unique_ptr<char, GFreeDeleter>;

namespace FSMeta {
namespace gio {

class MountIterator {
public:
  // Callback type for mount processing
  // Receives GUnixMountEntry which provides thread-safe access to mount data
  // Return true to continue iteration, false to stop
  using MountCallback = std::function<bool(GUnixMountEntry *)>;

  // Static method to iterate over mounts using thread-safe g_unix_mounts_get()
  // This is safe to call from worker threads
  static void forEachMount(const MountCallback &callback);

  // NOTE: tryGetMonitor() has been removed because GVolumeMonitor is NOT
  // thread-safe. See: https://docs.gtk.org/gio/class.VolumeMonitor.html
};

// Note: GioResource<T> has been removed in favor of GObjectPtr<T> above,
// which provides equivalent RAII semantics with std::unique_ptr.

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO