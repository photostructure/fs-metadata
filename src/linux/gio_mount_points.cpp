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

    MountIterator::forEachMount([this](GMount * /*mount*/, GFile *root) {
      const GCharPtr path(g_file_get_path(root));
      if (path) {
        const GFileInfoPtr info(g_file_query_filesystem_info(
            root, G_FILE_ATTRIBUTE_FILESYSTEM_TYPE, nullptr, nullptr));
        if (info) {
          const char *fs_type_str = g_file_info_get_attribute_string(
              info.get(), G_FILE_ATTRIBUTE_FILESYSTEM_TYPE);
          if (fs_type_str) {
            const GCharPtr fs_type(g_strdup(fs_type_str));
            DEBUG_LOG("[GioMountPoints] found {mountPoint: %s, fsType: %s}",
                      path.get(), fs_type.get());
            MountPoint point{};
            point.mountPoint = path.get();
            point.fstype = fs_type.get();
            mountPoints.push_back(point);
          }
        }
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