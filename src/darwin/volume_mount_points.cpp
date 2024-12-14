// src/darwin/volume_mount_points.cpp
#include "../common/volume_mount_points.h"
#include "fs_meta.h"
#include <chrono>
#include <future>
#include <sys/mount.h>
#include <unistd.h>

namespace FSMeta {

class GetVolumeMountPointsWorker : public Napi::AsyncWorker {
private:
  Napi::Promise::Deferred deferred_;
  std::vector<MountPoint> mountPoints_;
  uint32_t timeoutMs_;

public:
  GetVolumeMountPointsWorker(const Napi::Promise::Deferred &deferred,
                             uint32_t timeoutMs = 5000)
      : Napi::AsyncWorker(deferred.Env()), deferred_(deferred),
        timeoutMs_(timeoutMs) {}

  void Execute() override {
    try {
      // Get mount list - this is fast
      struct statfs *mntbufp;
      int count = getmntinfo(&mntbufp, MNT_WAIT);

      if (count <= 0) {
        throw std::runtime_error("Failed to get mount information");
      }

      for (int i = 0; i < count; i++) {
        MountPoint mp;
        mp.mountPoint = mntbufp[i].f_mntonname;
        mp.fstype = mntbufp[i].f_fstypename;

        // Wrap access check in async task with timeout
        auto future = std::async(std::launch::async, [&mp]() {
          return access(mp.mountPoint.c_str(), R_OK) == 0;
        });

        // Wait with timeout for access check
        if (future.wait_for(std::chrono::milliseconds(timeoutMs_)) ==
            std::future_status::timeout) {
          mp.status = "disconnected";
        } else {
          try {
            bool isAccessible = future.get();
            mp.status = isAccessible ? "healthy" : "inaccessible";
          } catch (...) {
            mp.status = "inaccessible";
          }
        }

        mountPoints_.push_back(std::move(mp));
      }
    } catch (const std::exception &e) {
      SetError(e.what());
    }
  }

  void OnOK() override {
    auto env = Env();
    auto result = Napi::Array::New(env, mountPoints_.size());

    for (size_t i = 0; i < mountPoints_.size(); i++) {
      result[i] = mountPoints_[i].ToObject(env);
    }

    deferred_.Resolve(result);
  }
};

Napi::Promise GetVolumeMountPoints(const Napi::CallbackInfo &info) {
  auto env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);

  // Parse options if provided
  uint32_t timeoutMs = 5000; // Default timeout

  MountPointOptions options;
  if (info.Length() > 0 && info[0].IsObject()) {
    options = MountPointOptions::FromObject(info[0].As<Napi::Object>());
  }

  auto *worker = new GetVolumeMountPointsWorker(deferred, options.timeoutMs);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta