// src/linux/gio_utils.cpp
#ifdef ENABLE_GIO

#include "gio_utils.h"
#include <gio/gio.h>
#include <memory>
#include <stdexcept>

namespace FSMeta {
namespace gio {

struct GObjectDeleter {
  void operator()(void* p) { if (p) g_object_unref(p); }
};

void addMountMetadata(const std::string &mountPoint, VolumeMetadata &metadata) {
  GVolumeMonitor* monitor = g_volume_monitor_get();
  if (!monitor) return;
  
  std::unique_ptr<GVolumeMonitor, GObjectDeleter> monitor_guard(monitor);
  GList* mounts = g_volume_monitor_get_mounts(monitor);
  if (!mounts) return;

  GList* l;
  for (l = mounts; l != nullptr; l = l->next) {
    GMount* mount = G_MOUNT(l->data);
    GFile* root = g_mount_get_root(mount);
    char* path = g_file_get_path(root);
    g_object_unref(root);

    if (path && mountPoint == path) {
      GVolume* volume = g_mount_get_volume(mount);
      if (volume) {
        char* name = g_volume_get_name(volume);
        if (name) {
          metadata.label = name;
          g_free(name);
        }
        g_object_unref(volume);
      }

      g_free(path);
    }
  }

  g_list_free_full(mounts, g_object_unref);
}

std::vector<TypedMountPoint> getMountPoints() {
  std::vector<TypedMountPoint> result;
  GVolumeMonitor* monitor = g_volume_monitor_get();
  if (!monitor) return result;

  std::unique_ptr<GVolumeMonitor, GObjectDeleter> monitor_guard(monitor);
  GList* mounts = g_volume_monitor_get_mounts(monitor);
  if (!mounts) return result;

  for (GList* l = mounts; l != nullptr; l = l->next) {
    GMount* mount = G_MOUNT(l->data);
    GFile* root = g_mount_get_root(mount);
    char* path = g_file_get_path(root);
    char* fs_type = g_mount_get_name(mount);
    g_object_unref(root);

    if (path && fs_type) {
      TypedMountPoint point;
      point.mountPoint = path;
      point.fstype = fs_type;
      result.push_back(point);
      g_free(path);
      g_free(fs_type);
    }
  }

  g_list_free_full(mounts, g_object_unref);
  return result;
}

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO