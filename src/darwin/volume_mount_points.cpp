// src/darwin/volume_mount_points.cpp
#include "../common/volume_mount_points.h"
#include "../common/debug_log.h"
#include "../common/error_utils.h"
#include "./fs_meta.h"
#include "./raii_utils.h"
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
      MountBufferRAII mntbuf;
      // Use MNT_NOWAIT for better performance - we'll verify accessibility
      // separately and our error handling already covers mount state changes
      // See https://github.com/swiftlang/swift-corelibs-foundation/issues/4649

      // getmntinfo_r_np is the thread-safe version of getmntinfo().
      // The "_r" suffix indicates "reentrant" (thread-safe).
      // The "_np" suffix indicates "non-portable" (Apple-specific).
      // This function allocates a new buffer that we must free (handled by
      // RAII).
      int count = getmntinfo_r_np(mntbuf.ptr(), MNT_NOWAIT);

      if (count <= 0) {
        if (count == 0) {
          throw std::runtime_error("No mount points found");
        } else {
          // getmntinfo_r_np returns -1 on error and sets errno
          throw FSException(
              CreateDetailedErrorMessage("getmntinfo_r_np", errno));
        }
      }

      // Process mount points in batches to limit concurrent threads
      const size_t maxConcurrentChecks = 4; // Limit concurrent access checks

      for (size_t i = 0; i < static_cast<size_t>(count);
           i += maxConcurrentChecks) {
        std::vector<std::future<std::pair<std::string, bool>>> futures;
        std::vector<MountPoint> batchMountPoints;

        // Create batch of mount points and launch their checks
        for (size_t j = i;
             j < static_cast<size_t>(count) && j < i + maxConcurrentChecks;
             j++) {
          MountPoint mp;
          mp.mountPoint = mntbuf.get()[j].f_mntonname;
          mp.fstype = mntbuf.get()[j].f_fstypename;
          mp.error = ""; // Initialize error field

          DEBUG_LOG("[GetVolumeMountPointsWorker] Checking mount point: %s",
                    mp.mountPoint.c_str());

          batchMountPoints.push_back(mp);

          // Launch async check
          futures.push_back(
              std::async(std::launch::async, [path = mp.mountPoint]() {
                // faccessat is preferred over access() for security:
                // - AT_FDCWD: Use current working directory as base
                // - AT_EACCESS: Check using effective user/group IDs (not real
                // IDs) This prevents TOCTOU attacks and privilege escalation
                // issues
                bool accessible =
                    faccessat(AT_FDCWD, path.c_str(), R_OK, AT_EACCESS) == 0;
                return std::make_pair(path, accessible);
              }));
        }

        // Process results for this batch
        for (size_t k = 0; k < futures.size(); k++) {
          auto &mp = batchMountPoints[k];
          try {
            auto status =
                futures[k].wait_for(std::chrono::milliseconds(timeoutMs_));

            switch (status) {
            case std::future_status::timeout:
              mp.status = "disconnected";
              mp.error = "Access check timed out";
              DEBUG_LOG(
                  "[GetVolumeMountPointsWorker] Access check timed out: %s",
                  mp.mountPoint.c_str());
              break;

            case std::future_status::ready:
              try {
                auto result = futures[k].get();
                bool isAccessible = result.second;
                mp.status = isAccessible ? "healthy" : "inaccessible";
                if (!isAccessible) {
                  mp.error = "Path is not accessible";
                }
                DEBUG_LOG("[GetVolumeMountPointsWorker] Access check %s: %s",
                          isAccessible ? "succeeded" : "failed",
                          mp.mountPoint.c_str());
              } catch (const std::exception &e) {
                mp.status = "error";
                mp.error = std::string("Access check failed: ") + e.what();
                DEBUG_LOG("[GetVolumeMountPointsWorker] Exception: %s",
                          e.what());
              }
              break;

            default:
              mp.status = "error";
              mp.error = "Unexpected future status";
              DEBUG_LOG("[GetVolumeMountPointsWorker] Unexpected status: %s",
                        mp.mountPoint.c_str());
              break;
            }
          } catch (const std::exception &e) {
            mp.status = "error";
            mp.error = std::string("Mount point check failed: ") + e.what();
            DEBUG_LOG("[GetVolumeMountPointsWorker] Exception: %s", e.what());
          }

          mountPoints_.push_back(std::move(mp));
        }
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