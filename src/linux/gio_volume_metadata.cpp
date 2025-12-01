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

    // NOTE: GVolumeMonitor enrichment has been removed.
    //
    // According to GIO documentation:
    // https://docs.gtk.org/gio/class.VolumeMonitor.html
    // "GVolumeMonitor is not thread-default-context aware and so should not
    // be used other than from the main thread, with no thread-default-context
    // active."
    //
    // This function is called from Napi::AsyncWorker::Execute() which runs
    // on a worker thread. Using GVolumeMonitor here causes race conditions
    // leading to GLib-GObject-CRITICAL errors like:
    //   "g_object_ref: assertion '!object_already_finalized' failed"
    //
    // The basic metadata (fstype, mountFrom) from g_unix_mounts_get() is
    // sufficient and thread-safe. Rich metadata (label, mountName, uri) can
    // be obtained from blkid or other thread-safe sources.

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