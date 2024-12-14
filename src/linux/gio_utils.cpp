// src/linux/gio_utils.cpp
#ifdef ENABLE_GIO

#include "gio_utils.h"
#include "../common/debug_log.h"
#include "gio_worker.h"
#include <gio/gio.h>
#include <memory>
#include <stdexcept>

namespace FSMeta {
namespace gio {

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

Napi::Value GetMountPoints(Napi::Env env) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GioMountPointsWorker(deferred);
  worker->Queue();
  return deferred.Promise();
}

void addMountMetadata(const std::string &mountPoint, VolumeMetadata &metadata) {
  DEBUG_LOG("[GIO] getting volume monitor for %s", mountPoint.c_str());
  GVolumeMonitor *monitor = g_volume_monitor_get();
  if (!monitor) {
    DEBUG_LOG("[GIO] failed to get volume monitor");
    return;
  }

  DEBUG_LOG("[GIO] getting mounts list");
  GList *mounts = g_volume_monitor_get_mounts(monitor);
  if (!mounts) {
    DEBUG_LOG("[GIO] no mounts found");
    return;
  }

  // Ensure mounts are freed when out of scope
  auto mounts_cleanup = [](GList *list) {
    g_list_free_full(list, reinterpret_cast<GDestroyNotify>(g_object_unref));
  };
  std::unique_ptr<GList, decltype(mounts_cleanup)> mounts_guard(mounts,
                                                                mounts_cleanup);

  for (GList *l = mounts; l != nullptr; l = l->next) {
    GMount *mount = G_MOUNT(l->data);
    if (!mount) {
      continue;
    }

    GObjectPtr<GFile> root(g_mount_get_root(mount));
    if (!root) {
      continue;
    }

    GCharPtr path(g_file_get_path(root.get()));
    if (!path) {
      continue;
    }

    if (mountPoint == path.get()) {
      DEBUG_LOG("[GIO] found matching mount point: %s", path.get());

      // Get volume information
      GObjectPtr<GVolume> volume(g_mount_get_volume(mount));
      if (volume) {
        GCharPtr name(g_volume_get_name(volume.get()));
        if (name) {
          metadata.label = name.get();
          DEBUG_LOG("[GIO] found volume label: %s", metadata.label.c_str());
        }
      }

      GCharPtr mount_name(g_mount_get_name(mount));
      if (mount_name) {
        metadata.mountName = mount_name.get();
      }

      GObjectPtr<GFile> location(g_mount_get_default_location(mount));
      if (location) {
        GCharPtr uri(g_file_get_uri(location.get()));
        if (uri) {
          metadata.uri = uri.get();
        }
      }

      if (metadata.fstype.empty()) {
        GObjectPtr<GDrive> drive(g_mount_get_drive(mount));
        if (drive) {
          GCharPtr unix_device(g_drive_get_identifier(
              drive.get(), G_DRIVE_IDENTIFIER_KIND_UNIX_DEVICE));
          if (unix_device) {
            metadata.fstype = unix_device.get();
            DEBUG_LOG("[GIO] found fstype: %s", metadata.fstype.c_str());
          }
        }
      }

      // Exit early since we've found the mount point
      break;
    }
  }
  // Mounts are automatically freed by mounts_guard
}

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO