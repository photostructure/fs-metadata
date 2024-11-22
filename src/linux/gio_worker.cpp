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

GioMountPointsWorker::~GioMountPointsWorker() { mountPoints.clear(); }

void GioMountPointsWorker::Execute() {
  try {
    GVolumeMonitor *monitor = g_volume_monitor_get();
    if (!monitor) {
      throw std::runtime_error("Failed to get GVolumeMonitor");
    }

    GList *mounts = g_volume_monitor_get_mounts(monitor);
    if (!mounts) {
      return;
    }

    for (GList *l = mounts; l != nullptr; l = l->next) {
      GMount *mount = G_MOUNT(l->data);
      if (!G_IS_MOUNT(mount)) {
        continue;
      }

      GFile *root = g_mount_get_root(mount);
      if (!G_IS_FILE(root)) {
        continue;
      }

      char *path = g_file_get_path(root);
      char *fs_type = g_mount_get_name(mount);

      if (path && fs_type) {
        MountPoint point{};
        point.mountPoint = path;
        point.fstype = fs_type;
        mountPoints.push_back(point);
      }

      if (path) {
        g_free(path);
      }
      if (fs_type) {
        g_free(fs_type);
      }
      g_object_unref(root);
    }

    g_list_free_full(mounts, g_object_unref);
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