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
      GVolumeMonitor *raw_monitor = MountIterator::tryGetMonitor();
      if (raw_monitor) {
        // IMPORTANT: g_volume_monitor_get() returns an owned reference that
        // MUST be unreffed. See:
        // https://docs.gtk.org/gio/type_func.VolumeMonitor.get.html
        // "The caller takes ownership and is responsible for freeing it."
        GVolumeMonitorPtr monitor(raw_monitor);

        DEBUG_LOG(
            "[gio::addMountMetadata] attempting GVolumeMonitor enrichment");

        // Try to find matching GMount for this path
        GList *mounts = g_volume_monitor_get_mounts(monitor.get());
        if (mounts) {
          for (GList *l = mounts; l != nullptr; l = l->next) {
            GMount *mount = G_MOUNT(l->data);
            if (!mount || !G_IS_MOUNT(mount)) {
              continue;
            }

            // Use RAII wrappers for exception safety - if std::string
            // assignment throws std::bad_alloc, resources are still cleaned up
            GFilePtr root(g_mount_get_root(mount));
            if (root) {
              GCharPtr path(g_file_get_path(root.get()));
              if (path && mountPoint == path.get()) {
                // Found matching mount - try to get rich metadata

                // Try to get volume label
                if (metadata.label.empty()) {
                  GVolumePtr volume(g_mount_get_volume(mount));
                  if (volume) {
                    GCharPtr label(g_volume_get_name(volume.get()));
                    if (label) {
                      DEBUG_LOG("[gio::addMountMetadata] {mountPoint: %s, "
                                "label: %s} (from GVolume)",
                                path.get(), label.get());
                      metadata.label = label.get();
                    }
                  }
                }

                // Try to get mount name
                if (metadata.mountName.empty()) {
                  GCharPtr mount_name(g_mount_get_name(mount));
                  if (mount_name) {
                    metadata.mountName = mount_name.get();
                  }
                }

                // Try to get URI
                if (metadata.uri.empty()) {
                  GFilePtr location(g_mount_get_default_location(mount));
                  if (location) {
                    GCharPtr uri(g_file_get_uri(location.get()));
                    if (uri) {
                      DEBUG_LOG("[gio::addMountMetadata] {mountPoint: %s, uri: "
                                "%s} (from GMount)",
                                path.get(), uri.get());
                      metadata.uri = uri.get();
                    }
                  }
                }

                break; // Found our mount, RAII handles cleanup
              }
              // path and root cleaned up by RAII
            }
          }

          // Clean up mounts list - each GMount in the list must be unreffed
          g_list_free_full(mounts,
                           reinterpret_cast<GDestroyNotify>(g_object_unref));
        }
        // monitor cleaned up by GVolumeMonitorPtr destructor
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