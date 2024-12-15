// src/linux/gio_worker.cpp
#ifdef ENABLE_GIO

#include "gio_worker.h"
#include "../common/debug_log.h"
#include "gio_utils.h"
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
    DEBUG_LOG("[GioMountPoints] getting volume monitor");
    GVolumeMonitor *monitor = g_volume_monitor_get();
    if (!monitor) {
      DEBUG_LOG("[GioMountPoints] failed to get volume monitor");
      throw std::runtime_error("Failed to get GVolumeMonitor");
    }

    DEBUG_LOG("[GioMountPoints] getting mounts list");
    GList *mounts = g_volume_monitor_get_mounts(monitor);
    if (!mounts) {
      DEBUG_LOG("[GioMountPoints] no mounts found");
      return;
    }

    DEBUG_LOG("[GioMountPoints] processing mounts");
    for (GList *l = mounts; l != nullptr; l = l->next) {
      GMount *mount = G_MOUNT(l->data);
      if (!G_IS_MOUNT(mount)) {
        DEBUG_LOG("[GioMountPoints] skipping invalid mount");
        continue;
      }

      GFile *root = g_mount_get_root(mount);
      if (!G_IS_FILE(root)) {
        DEBUG_LOG("[GioMountPoints] skipping mount with invalid root");
        continue;
      }

      GCharPtr path(g_file_get_path(root));
      GCharPtr fs_type(g_mount_get_name(mount));

      if (path && fs_type) {
        DEBUG_LOG("[GioMountPoints] found mount point: %s (%s)", path.get(),
                  fs_type.get());
        MountPoint point{};
        point.mountPoint = path.get();
        point.fstype = fs_type.get();
        mountPoints.push_back(point);
      }

      g_object_unref(root);
    }

    DEBUG_LOG("[GioMountPoints] found %zu mount points", mountPoints.size());
    g_list_free_full(mounts, g_object_unref);
  } catch (const std::exception &e) {
    DEBUG_LOG("[GioMountPoints] error: %s", e.what());
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