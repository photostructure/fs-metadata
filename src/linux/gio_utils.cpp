// src/linux/gio_utils.cpp

#ifdef ENABLE_GIO

#include "gio_utils.h"
#include "../common/debug_log.h"
#include <gio/gio.h>
#include <memory>
#include <stdexcept>

namespace FSMeta {
namespace gio {

// HEY FUTURE ME: DON'T `g_object_unref` THIS POINTER!
GVolumeMonitor *MountIterator::getMonitor() {
  GVolumeMonitor *monitor = g_volume_monitor_get();
  if (!monitor) {
    DEBUG_LOG("[gio::getMonitor] g_volume_monitor_get() failed");
    throw std::runtime_error("Failed to get GVolumeMonitor");
  }
  return monitor;
}

void MountIterator::forEachMount(const MountCallback &callback) {
  GList *mounts = g_volume_monitor_get_mounts(getMonitor());

  if (!mounts) {
    DEBUG_LOG("[gio::MountIterator::forEachMount] no mounts found");
    return;
  }

  // Process each mount
  for (GList *l = mounts; l != nullptr; l = l->next) {
    GMount *mount = G_MOUNT(l->data);

    if (!G_IS_MOUNT(mount)) {
      DEBUG_LOG("[gio::MountIterator::forEachMount] Skipping invalid mount");
      continue;
    }

    // Take an extra reference on the mount while we work with it
    g_object_ref(mount);

    try {
      const GioResource<GFile> root(g_mount_get_root(mount));

      // Check both for null and valid GFile
      if (root.get() && G_IS_FILE(root.get())) {
        const bool continue_iteration = callback(mount, root.get());
        g_object_unref(mount);

        if (!continue_iteration) {
          break;
        }
      } else {
        DEBUG_LOG(
            "[gio::MountIterator::forEachMount] Invalid root file object");
        g_object_unref(mount);
      }
    } catch (const std::exception &e) {
      DEBUG_LOG("[gio::MountIterator::forEachMount] Exception during mount "
                "processing: %s",
                e.what());
      g_object_unref(mount);
      throw; // Re-throw to maintain current behavior
    }
  }

  // Free the mounts list and unref each mount
  g_list_free_full(mounts, reinterpret_cast<GDestroyNotify>(g_object_unref));
}

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO