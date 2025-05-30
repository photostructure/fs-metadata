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

  MountIterator::forEachMount([&](GMount *mount, GFile *root) {
    const GCharPtr path(g_file_get_path(root));
    if (!path || mountPoint != path.get()) {
      return true; // Continue iteration
    }

    // Found matching mount point
    DEBUG_LOG("[gio::addMountMetadata] found matching mount point: %s",
              path.get());

    // Get volume information
    const GObjectPtr<GVolume> volume(g_mount_get_volume(mount));
    if (volume && volume.get()) {
      const GCharPtr label(g_volume_get_name(volume.get()));
      if (label && label.get()) {
        DEBUG_LOG("[gio::addMountMetadata] {mountPoint: %s, label: %s}",
                  path.get(), label.get());
        metadata.label = label.get();
      }
    }

    const GCharPtr mount_name(g_mount_get_name(mount));
    if (mount_name) {
      metadata.mountName = mount_name.get();
    }

    const GObjectPtr<GFile> location(g_mount_get_default_location(mount));
    if (location && location.get()) {
      const GCharPtr uri(g_file_get_uri(location.get()));
      if (uri && uri.get()) {
        DEBUG_LOG("[gio::addMountMetadata] {mountPoint: %s, uri: %s}",
                  path.get(), uri.get());
        metadata.uri = uri.get();
      }
    }

    if (metadata.fstype.empty()) {
      const GFileInfoPtr info(g_file_query_filesystem_info(
          root, G_FILE_ATTRIBUTE_FILESYSTEM_TYPE, nullptr, nullptr));
      if (info) {
        const char *fs_type_str = g_file_info_get_attribute_string(
            info.get(), G_FILE_ATTRIBUTE_FILESYSTEM_TYPE);
        if (fs_type_str) {
          const GCharPtr fs_type(g_strdup(fs_type_str));
          DEBUG_LOG("[gio::addMountMetadata] {mountPoint: %s, fsType: %s}",
                    path.get(), fs_type.get());
          metadata.fstype = fs_type.get();
        }
      }
    }

    if (metadata.mountFrom.empty()) {
      const GObjectPtr<GDrive> drive(g_mount_get_drive(mount));
      if (drive) {
        const GCharPtr unix_device(g_drive_get_identifier(
            drive.get(), G_DRIVE_IDENTIFIER_KIND_UNIX_DEVICE));
        if (unix_device) {
          DEBUG_LOG("[gio::addMountMetadata] {mountPoint: %s, mountFrom: %s}",
                    path.get(), unix_device.get());
          metadata.mountFrom = unix_device.get();
        }
      }
    }

    return false; // Stop iteration, we found our mount
  });
}

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO