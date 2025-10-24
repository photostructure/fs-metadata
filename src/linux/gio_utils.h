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

// Custom deleter for g_free
struct GFreeDeleter {
  void operator()(void *ptr) const {
    if (ptr) {
      g_free(ptr);
    }
  }
};

// Add this before any existing smart pointer definitions
struct GFileInfoDeleter {
  void operator()(GFileInfo *ptr) {
    if (ptr)
      g_object_unref(ptr);
  }
};
using GFileInfoPtr = std::unique_ptr<GFileInfo, GFileInfoDeleter>;

// Smart pointer aliases
template <typename T> using GObjectPtr = std::unique_ptr<T, GObjectDeleter<T>>;

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

  // OPTIONAL: Try to get GVolumeMonitor for metadata enrichment
  // Returns nullptr if unavailable (that's OK, not required)
  // WARNING: Violates thread-safety when called from worker threads
  // Only use for best-effort enrichment
  static GVolumeMonitor *tryGetMonitor() noexcept;
};

// Helper class for scoped GIO resource management
template <typename T> class GioResource {
public:
  explicit GioResource(T *resource) : resource_(resource) {}
  ~GioResource() {
    if (resource_) {
      g_object_unref(resource_);
    }
  }

  T *get() const { return resource_; }
  T *release() {
    T *temp = resource_;
    resource_ = nullptr;
    return temp;
  }

  // Prevent copying
  GioResource(const GioResource &) = delete;
  GioResource &operator=(const GioResource &) = delete;

private:
  T *resource_;
};

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO