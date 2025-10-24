// src/linux/gio_utils.cpp
//
// Thread-Safe Mount Enumeration for Linux
//
// This implementation uses g_unix_mounts_get() as the primary, thread-safe path
// for enumerating mounts. GVolumeMonitor is optionally used for enrichment but
// is NOT required for correct operation.
//
// IMPORTANT THREAD SAFETY NOTES:
//
// According to GIO documentation
// (https://docs.gtk.org/gio/class.VolumeMonitor.html): "GVolumeMonitor is not
// thread-default-context aware and so should not be used other than from the
// main thread, with no thread-default-context active."
//
// However, g_unix_mounts_get() is explicitly thread-safe:
// - Uses getmntent_r() when available (reentrant)
// - Falls back to getmntent() with G_LOCK protection
// See: https://gitlab.gnome.org/GNOME/glib/-/blob/main/gio/gunixmounts.c
//
// This design:
// ✅ Primary path uses thread-safe g_unix_mounts_get()
// ✅ Optional GVolumeMonitor enhancement (best-effort, may be skipped)
// ✅ Fixes Finding #6 (thread safety violation)
// ✅ Fixes Finding #7 (double-free risk with g_list_free_full)

#ifdef ENABLE_GIO

#include "gio_utils.h"
#include "../common/debug_log.h"
#include <gio/gio.h>
#include <gio/gunixmounts.h>
#include <memory>
#include <stdexcept>

namespace FSMeta {
namespace gio {

void MountIterator::forEachMount(const MountCallback &callback) {
  // PRIMARY PATH: Thread-safe Unix mount enumeration
  // g_unix_mounts_get() is documented as thread-safe and can be called
  // from worker threads without violating GIO threading requirements.
  GList *unix_mounts = g_unix_mounts_get(nullptr);

  if (!unix_mounts) {
    DEBUG_LOG("[gio::MountIterator::forEachMount] no mounts found");
    return;
  }

  DEBUG_LOG("[gio::MountIterator::forEachMount] processing Unix mounts");

  // Iterate over all Unix mounts
  GList *current = unix_mounts;
  bool should_continue = true;

  while (current && should_continue) {
    GUnixMountEntry *entry = static_cast<GUnixMountEntry *>(current->data);

    if (!entry) {
      DEBUG_LOG("[gio::MountIterator::forEachMount] Skipping null entry");
      current = current->next;
      continue;
    }

    try {
      // Get mount path from thread-safe Unix mount API
      const char *mount_path = g_unix_mount_get_mount_path(entry);
      if (!mount_path) {
        DEBUG_LOG(
            "[gio::MountIterator::forEachMount] Skipping mount with null path");
        current = current->next;
        continue;
      }

      DEBUG_LOG("[gio::MountIterator::forEachMount] processing mount: %s",
                mount_path);

      // Invoke callback with Unix mount entry
      // The callback receives the entry and can extract data using
      // g_unix_mount_get_* functions
      should_continue = callback(entry);

    } catch (const std::exception &e) {
      DEBUG_LOG("[gio::MountIterator::forEachMount] Exception during mount "
                "processing: %s",
                e.what());
      // Clean up and re-throw
      g_list_free_full(unix_mounts,
                       reinterpret_cast<GDestroyNotify>(g_unix_mount_free));
      throw;
    }

    current = current->next;
  }

  // Free list and all mount entries
  // Each entry is freed with g_unix_mount_free() - no double-free risk
  g_list_free_full(unix_mounts,
                   reinterpret_cast<GDestroyNotify>(g_unix_mount_free));

  DEBUG_LOG("[gio::MountIterator::forEachMount] completed");
}

// OPTIONAL: Try to get GVolumeMonitor (may fail, that's OK)
// This is best-effort enrichment and should NOT be required for basic operation
GVolumeMonitor *MountIterator::tryGetMonitor() noexcept {
  try {
    // NOTE: This violates GVolumeMonitor thread-safety requirements when
    // called from worker threads. We use it only for optional metadata
    // enrichment. The primary path uses thread-safe g_unix_mounts_get().
    //
    // Future work: Consider removing this entirely or moving enrichment
    // to main thread if needed.
    GVolumeMonitor *monitor = g_volume_monitor_get();
    if (!monitor) {
      DEBUG_LOG("[gio::tryGetMonitor] g_volume_monitor_get() returned null");
    }
    return monitor; // May be null, caller must check
  } catch (const std::exception &e) {
    DEBUG_LOG("[gio::tryGetMonitor] Exception: %s", e.what());
    return nullptr;
  } catch (...) {
    DEBUG_LOG("[gio::tryGetMonitor] Unknown exception");
    return nullptr;
  }
}

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO