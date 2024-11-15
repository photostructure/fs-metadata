// src/linux/gio_utils.cpp
#ifdef ENABLE_GIO

#include "gio_utils.h"
#include <gio/gio.h>
#include <memory>
#include <stdexcept>

namespace FSMeta {
namespace gio {

struct GObjectDeleter {
  void operator()(void *p) {
    if (p)
      g_object_unref(p);
  }
};

void addMountMetadata(const std::string &mountPoint, VolumeMetadata &metadata) {
  GVolumeMonitor *monitor = g_volume_monitor_get();
  if (!monitor)
    return;

  std::unique_ptr<GVolumeMonitor, GObjectDeleter> monitor_guard(monitor);
  GList *mounts = g_volume_monitor_get_mounts(monitor);
  if (!mounts)
    return;

  GList *l;
  for (l = mounts; l != nullptr; l = l->next) {
    GMount *mount = G_MOUNT(l->data);
    GFile *root = g_mount_get_root(mount);
    char *path = g_file_get_path(root);
    g_object_unref(root); // Ensure root is unreferenced

    if (path && mountPoint == path) {
      GVolume *volume = g_mount_get_volume(mount);
      if (volume) {
        char *name = g_volume_get_name(volume);
        if (name) {
          metadata.label = name;
          g_free(name);
        }
        g_object_unref(volume); // Ensure volume is unreferenced
      }

      g_free(path); // Ensure path is freed
    }
  }

  g_list_free_full(mounts, g_object_unref); // Ensure mounts list is freed
}

std::vector<TypedMountPoint> getMountPoints() {
  std::vector<TypedMountPoint> result;
  GVolumeMonitor *monitor = g_volume_monitor_get();
  if (!monitor)
    return result;

  GList *mounts = g_volume_monitor_get_mounts(monitor);
  if (!mounts) {
    g_object_unref(monitor);
    return result;
  }

  for (GList *l = mounts; l != nullptr; l = l->next) {
    GMount *mount = G_MOUNT(l->data);
    if (!G_IS_MOUNT(mount)) {
      continue;
    }

    g_object_ref(mount); // Increase reference count for safe usage

    GFile *root = g_mount_get_root(mount);
    if (!G_IS_FILE(root)) {
      g_object_unref(mount);
      continue;
    }

    char *path = g_file_get_path(root);
    char *fs_type = g_mount_get_name(mount);
    g_object_unref(root);

    if (path && fs_type) {
      TypedMountPoint point;
      point.mountPoint = path;
      point.fstype = fs_type;
      result.push_back(point);
      g_free(path);
      g_free(fs_type);
    }

    g_object_unref(mount); // Unreference the GMount object
  }

  g_list_free_full(mounts, g_object_unref);
  g_object_unref(monitor); // Unreference the GVolumeMonitor object
  return result;
}

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO