// src/darwin/volume_mount_points.cpp
#include "../common/volume_mount_points.h"
#include "../common/debug_log.h"
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
    DEBUG_LOG("[GetVolumeMountPointsWorker] Executing");
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
        mp.error = ""; // Initialize error field

        DEBUG_LOG("[GetVolumeMountPointsWorker] Checking mount point: %s",
                  mp.mountPoint.c_str());

        try {
          // Use shared_future to allow multiple gets
          std::shared_future<bool> future =
              std::async(std::launch::async, [path = mp.mountPoint]() {
                return access(path.c_str(), R_OK) == 0;
              }).share();

          auto status = future.wait_for(std::chrono::milliseconds(timeoutMs_));

          if (status == std::future_status::timeout) {
            mp.status = "disconnected";
            mp.error = "Access check timed out";
            DEBUG_LOG(
                "[GetVolumeMountPointsWorker] Access check timed out for: %s",
                mp.mountPoint.c_str());
          } else if (status == std::future_status::ready) {
            try {
              bool isAccessible = future.get();
              mp.status = isAccessible ? "healthy" : "inaccessible";
              if (!isAccessible) {
                mp.error = "Path is not accessible";
              }
              DEBUG_LOG("[GetVolumeMountPointsWorker] Access check %s for: %s",
                        isAccessible ? "succeeded" : "failed",
                        mp.mountPoint.c_str());
            } catch (const std::exception &e) {
              mp.status = "error";
              mp.error = std::string("Access check failed: ") + e.what();
              DEBUG_LOG("[GetVolumeMountPointsWorker] Exception: %s", e.what());
            }
          } else {
            mp.status = "error";
            mp.error = "Unexpected future status";
            DEBUG_LOG(
                "[GetVolumeMountPointsWorker] Unexpected future status for: %s",
                mp.mountPoint.c_str());
          }
        } catch (const std::exception &e) {
          mp.status = "error";
          mp.error = std::string("Mount point check failed: ") + e.what();
          DEBUG_LOG("[GetVolumeMountPointsWorker] Exception: %s", e.what());
        }

        mountPoints_.push_back(std::move(mp));
      }
    } catch (const std::exception &e) {
      SetError(std::string("Failed to process mount points: ") + e.what());
      DEBUG_LOG("[GetVolumeMountPointsWorker] Exception: %s", e.what());
    }
  }

  void OnOK() override {
    DEBUG_LOG("[GetVolumeMountPointsWorker] OnOK");
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
  DEBUG_LOG("[GetVolumeMountPoints] called");

  auto deferred = Napi::Promise::Deferred::New(env);

  MountPointOptions options;
  if (info.Length() > 0 && info[0].IsObject()) {
    options = MountPointOptions::FromObject(info[0].As<Napi::Object>());
  }

  auto *worker = new GetVolumeMountPointsWorker(deferred, options.timeoutMs);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta