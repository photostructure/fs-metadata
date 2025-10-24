// src/linux/gio_mount_points.cpp
#ifdef ENABLE_GIO

#include "gio_mount_points.h"
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
    DEBUG_LOG("[GioMountPoints] processing mounts");

    // Use thread-safe g_unix_mounts_get() API
    MountIterator::forEachMount([this](GUnixMountEntry *entry) {
      // Get mount path and filesystem type from thread-safe Unix mount API
      const char *mount_path = g_unix_mount_get_mount_path(entry);
      const char *fs_type = g_unix_mount_get_fs_type(entry);

      if (mount_path && fs_type) {
        DEBUG_LOG("[GioMountPoints] found {mountPoint: %s, fsType: %s}",
                  mount_path, fs_type);

        MountPoint point{};
        point.mountPoint = mount_path;
        point.fstype = fs_type;
        mountPoints.push_back(point);
      } else {
        DEBUG_LOG("[GioMountPoints] skipping mount with null path or fstype");
      }

      return true; // Continue iteration
    });

    DEBUG_LOG("[GioMountPoints] found %zu mount points", mountPoints.size());
  } catch (const std::exception &e) {
    DEBUG_LOG("[GioMountPoints] error: %s", e.what());
    SetError(e.what());
  }
}

void GioMountPointsWorker::OnOK() {
  const Napi::HandleScope scope(Env());
  const Napi::Array result = Napi::Array::New(Env());

  for (size_t i = 0; i < mountPoints.size(); i++) {
    const Napi::Object point = Napi::Object::New(Env());
    point.Set("mountPoint", mountPoints[i].mountPoint);
    point.Set("fstype", mountPoints[i].fstype);
    result.Set(i, point);
  }

  deferred_.Resolve(result);
}

void GioMountPointsWorker::OnError(const Napi::Error &error) {
  deferred_.Reject(error.Value());
}

Napi::Value GetMountPoints(Napi::Env env) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GioMountPointsWorker(deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO