// src/linux/gio_worker.h
#pragma once

#ifdef ENABLE_GIO

#include "typed_mount_point.h"
#include <napi.h>
#include <string>
#include <vector>

namespace FSMeta {
namespace gio {

class GioMountPointsWorker : public Napi::AsyncWorker {
public:
  explicit GioMountPointsWorker(const Napi::Promise::Deferred &deferred);

  void Execute() override;
  void OnOK() override;
  void OnError(const Napi::Error &error) override;

private:
  std::vector<TypedMountPoint> mountPoints;
  Napi::Promise::Deferred deferred_;
};

} // namespace gio
} // namespace FSMeta

#endif // ENABLE_GIO