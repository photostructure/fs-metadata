// src/linux/gio_volume_metadata.cpp

#ifdef ENABLE_GIO

#include "gio_volume_metadata.h"
#include "../common/debug_log.h"
#include "gio_utils.h"
#include <gio/gio.h>
#include <memory>
#include <stdexcept>

namespace FSMeta {
namespace gio {

void addMountMetadata(const std::string &mountPoint, VolumeMetadata &metadata) {
  DEBUG_LOG("[gio::addMountMetadata] getting mount metadata for %s",
            mountPoint.c_str());

  bool found = false;

  // PRIMARY PATH: Thread-safe Unix mount API
  MountIterator::forEachMount([&](GUnixMountEntry *entry) {
    const char *mount_path = g_unix_mount_get_mount_path(entry);
    if (!mount_path || mountPoint != mount_path) {
      return true; // Continue iteration
    }

    // Found matching mount point
    DEBUG_LOG("[gio::addMountMetadata] found matching mount point: %s",
              mount_path);
    found = true;

    // Get basic metadata from thread-safe Unix mount API
    if (metadata.fstype.empty()) {
      const char *fs_type = g_unix_mount_get_fs_type(entry);
      if (fs_type) {
        DEBUG_LOG("[gio::addMountMetadata] {mountPoint: %s, fsType: %s}",
                  mount_path, fs_type);
        metadata.fstype = fs_type;
      }
    }

    if (metadata.mountFrom.empty()) {
      const char *device_path = g_unix_mount_get_device_path(entry);
      if (device_path) {
        DEBUG_LOG("[gio::addMountMetadata] {mountPoint: %s, mountFrom: %s}",
                  mount_path, device_path);
        metadata.mountFrom = device_path;
      }
    }

    // OPTIONAL ENHANCEMENT: Try to get rich metadata from GVolumeMonitor
    // This may fail (thread safety violation), but that's OK - we have basic
    // data
    try {
      GVolumeMonitor *monitor = MountIterator::tryGetMonitor();
      if (monitor) {
        DEBUG_LOG(
            "[gio::addMountMetadata] attempting GVolumeMonitor enrichment");

        // Try to find matching GMount for this path
        GList *mounts = g_volume_monitor_get_mounts(monitor);
        if (mounts) {
          for (GList *l = mounts; l != nullptr; l = l->next) {
            GMount *mount = G_MOUNT(l->data);
            if (!mount || !G_IS_MOUNT(mount)) {
              continue;
            }

            GFile *root = g_mount_get_root(mount);
            if (root) {
              char *path = g_file_get_path(root);
              if (path && mountPoint == path) {
                // Found matching mount - try to get rich metadata

                // Try to get volume label
                if (metadata.label.empty()) {
                  GVolume *volume = g_mount_get_volume(mount);
                  if (volume) {
                    char *label = g_volume_get_name(volume);
                    if (label) {
                      DEBUG_LOG("[gio::addMountMetadata] {mountPoint: %s, "
                                "label: %s} (from GVolume)",
                                path, label);
                      metadata.label = label;
                      g_free(label);
                    }
                    g_object_unref(volume);
                  }
                }

                // Try to get mount name
                if (metadata.mountName.empty()) {
                  char *mount_name = g_mount_get_name(mount);
                  if (mount_name) {
                    metadata.mountName = mount_name;
                    g_free(mount_name);
                  }
                }

                // Try to get URI
                if (metadata.uri.empty()) {
                  GFile *location = g_mount_get_default_location(mount);
                  if (location) {
                    char *uri = g_file_get_uri(location);
                    if (uri) {
                      DEBUG_LOG("[gio::addMountMetadata] {mountPoint: %s, uri: "
                                "%s} (from GMount)",
                                path, uri);
                      metadata.uri = uri;
                      g_free(uri);
                    }
                    g_object_unref(location);
                  }
                }

                g_free(path);
                g_object_unref(root);
                break; // Found our mount
              }
              if (path)
                g_free(path);
              g_object_unref(root);
            }
          }

          // Clean up mounts list - this time correctly without double-free
          g_list_free_full(mounts,
                           reinterpret_cast<GDestroyNotify>(g_object_unref));
        }

        // Note: Don't unref monitor - it's a singleton
      }
    } catch (const std::exception &e) {
      DEBUG_LOG("[gio::addMountMetadata] GVolumeMonitor enrichment failed "
                "(expected, not critical): %s",
                e.what());
      // Ignore - we have basic metadata from Unix mount API
    }

    return false; // Stop iteration, we found our mount
  });

  if (!found) {
    DEBUG_LOG("[gio::addMountMetadata] mount point %s not found",
              mountPoint.c_str());
  }
}

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO