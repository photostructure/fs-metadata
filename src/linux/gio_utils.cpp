#ifdef ENABLE_GIO

#include "gio_utils.h"
#include "fs_meta.h"
#include "gio_worker.h"
#include <gio/gio.h>
#include <iostream>
#include <memory>
#include <stdexcept>

namespace FSMeta {
namespace gio {

// Custom deleter for GObject types
struct GObjectDeleter {
  void operator()(void *ptr) const {
    if (ptr) {
      g_object_unref(ptr);
    }
  }
};

// Type aliases for common GObject smart pointers
using GVolumeMonitorPtr = std::unique_ptr<GVolumeMonitor, GObjectDeleter>;
using GObjectPtr = std::unique_ptr<GObject, GObjectDeleter>;
using GFilePtr = std::unique_ptr<GFile, GObjectDeleter>;
using GVolumePtr = std::unique_ptr<GVolume, GObjectDeleter>;
using GMountPtr = std::unique_ptr<GMount, GObjectDeleter>;
using GUriPtr = std::unique_ptr<GUri, GObjectDeleter>;

Napi::Value GetMountPoints(Napi::Env env) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GioMountPointsWorker(deferred);
  worker->Queue();
  return deferred.Promise();
}

void addMountMetadata(const std::string &mountPoint, VolumeMetadata &metadata) {

  GVolumeMonitor *monitor = g_volume_monitor_get();
  if (!monitor) {
    return;
  }

  std::unique_ptr<GVolumeMonitor, GObjectDeleter> monitor_guard(monitor);
  GList *mounts = g_volume_monitor_get_mounts(monitor);
  if (!mounts) {
    return;
  }

  int mount_count = 0;

  for (GList *l = mounts; l != nullptr; l = l->next) {
    mount_count++;
    GMount *mount = G_MOUNT(l->data);
    if (!mount) {
      continue;
    }

    GFile *root = g_mount_get_root(mount);
    if (!root) {
      continue;
    }

    char *path = g_file_get_path(root);

    if (path && mountPoint == path) {

      // Get volume name
      GVolume *volume = g_mount_get_volume(mount);
      if (volume) {
        char *name = g_volume_get_name(volume);
        if (name) {
          metadata.label = name;
          g_free(name);
        }
        g_object_unref(volume);
      }

      // Get mount name (can include filesystem type info)
      char *mount_name = g_mount_get_name(mount);
      if (mount_name) {
        g_free(mount_name);
      }

      // Get location and URI
      GFile *location = g_mount_get_default_location(mount);
      if (location) {

        // Try different URI methods
        char *uri = g_file_get_uri(location);
        char *parse_name = g_file_get_parse_name(location);

        if (uri) {
          metadata.uri = uri;

          // Parse URI for remote details
          GError *error = nullptr;
          GUri *parsed_uri = g_uri_parse(uri, G_URI_FLAGS_NONE, &error);
          if (parsed_uri) {
            const char *scheme = g_uri_get_scheme(parsed_uri);

            if (scheme && strcmp(scheme, "file") != 0) {
              metadata.remote = true;
              metadata.fileSystem = scheme;

              const char *host = g_uri_get_host(parsed_uri);
              const char *path = g_uri_get_path(parsed_uri);

              if (host)
                metadata.remoteHost = host;
              if (path && path[0] == '/')
                metadata.remoteShare = path + 1;
            }
            g_uri_unref(parsed_uri);
          } else {
            if (error) {
              g_error_free(error);
            }
          }
          g_free(uri);
        }

        if (parse_name) {
          g_free(parse_name);
        }
        g_object_unref(location);
      }

      // Try additional methods to get filesystem info
      if (metadata.fileSystem.empty()) {
        GDrive *drive = g_mount_get_drive(mount);
        if (drive) {
          // Try to get unix device path
          char *unix_device = g_drive_get_identifier(
              drive, G_DRIVE_IDENTIFIER_KIND_UNIX_DEVICE);
          if (unix_device) {
            // std::cout << "  Unix device path: " << unix_device << std::endl;
            g_free(unix_device);
          }
          g_object_unref(drive);
        }
      }

      g_object_unref(root);
      break;
    }
    g_object_unref(root);
    g_free(path);
  }

  g_list_free_full(mounts, g_object_unref);
}

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO