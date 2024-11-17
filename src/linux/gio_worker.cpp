// src/linux/gio_worker.cpp
#ifdef ENABLE_GIO

#include "gio_worker.h"
#include <gio/gio.h>
#include <memory>
#include <stdexcept>

namespace FSMeta {
namespace gio {

GioMountPointsWorker::GioMountPointsWorker(
    const Napi::Promise::Deferred &deferred)
    : Napi::AsyncWorker(deferred.Env()), deferred_(deferred) {}

void GioMountPointsWorker::Execute() {
  try {
    GVolumeMonitor *monitor = g_volume_monitor_get();
    if (!monitor) {
      throw std::runtime_error("Failed to get GVolumeMonitor");
    }

    std::unique_ptr<GVolumeMonitor, decltype(&g_object_unref)> monitor_guard(
        monitor, g_object_unref);
    GList *mounts = g_volume_monitor_get_mounts(monitor);

    if (!mounts) {
      return; // No mounts is not an error
    }

    std::unique_ptr<GList, decltype(&g_list_free)> mounts_guard(mounts,
                                                                g_list_free);

    for (GList *l = mounts; l != nullptr; l = l->next) {
      GMount *mount = G_MOUNT(l->data);
      if (!G_IS_MOUNT(mount)) {
        continue;
      }

      std::unique_ptr<GMount, decltype(&g_object_unref)> mount_guard(
          mount, g_object_unref);
      GFile *root = g_mount_get_root(mount);
      if (!G_IS_FILE(root)) {
        continue;
      }

      std::unique_ptr<GFile, decltype(&g_object_unref)> root_guard(
          root, g_object_unref);
      char *path = g_file_get_path(root);
      char *fs_type = g_mount_get_name(mount);

      if (path && fs_type) {
        TypedMountPoint point{};
        point.mountPoint = path;
        point.fstype = fs_type;
        mountPoints.push_back(point);
        g_free(path);
        g_free(fs_type);
      }
    }
  } catch (const std::exception &e) {
    SetError(e.what());
  }
}

void GioMountPointsWorker::OnOK() {
  Napi::HandleScope scope(Env());
  Napi::Array result = Napi::Array::New(Env());

  for (size_t i = 0; i < mountPoints.size(); i++) {
    Napi::Object point = Napi::Object::New(Env());
    point.Set("mountPoint", mountPoints[i].mountPoint);
    point.Set("fstype", mountPoints[i].fstype);
    result.Set(i, point);
  }

  deferred_.Resolve(result);
}

void GioMountPointsWorker::OnError(const Napi::Error &error) {
  deferred_.Reject(error.Value());
}

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO