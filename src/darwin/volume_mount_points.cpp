// src/darwin/volume_mount_points.cpp
#include "../common/volume_mount_points.h"
#include "../common/debug_log.h"
#include "../common/error_utils.h"
#include "../common/shutdown.h"
#include "./da_mutex.h"
#include "./fs_meta.h"
#include "./raii_utils.h"
#include "./system_volume.h"
#include <chrono>
#include <future>
#include <mutex>
#include <sys/mount.h>
#include <thread>
#include <unistd.h>
#include <unordered_map>

namespace FSMeta {

namespace {

// In-flight accessibility probes keyed by mount path. A probe stuck in
// faccessat() on a dead network mount is reused by later calls instead of
// spawning another thread, so at most one probe thread exists per distinct
// hung path — repeated getVolumeMountPoints() polling cannot accumulate
// stuck threads without bound. Deliberately leaked (never destroyed):
// detached probe threads may still touch these during process exit.
std::mutex *const g_probeMutex = new std::mutex();
auto *const g_inflightProbes =
    new std::unordered_map<std::string, std::shared_future<bool>>();

// Returns a future answering "is path readable?", reusing any in-flight
// probe for the same path. std::async is deliberately avoided: the
// destructor of a std::async future blocks until the task finishes, so a
// hung faccessat() would pin the worker thread even after its timeout was
// reported. A promise + detached-thread pair yields futures whose
// destructors never block.
std::shared_future<bool> StartAccessProbe(const std::string &path) {
  std::lock_guard<std::mutex> lock(*g_probeMutex);
  auto it = g_inflightProbes->find(path);
  if (it != g_inflightProbes->end()) {
    return it->second;
  }
  auto promise = std::make_shared<std::promise<bool>>();
  std::shared_future<bool> future = promise->get_future().share();
  g_inflightProbes->emplace(path, future);
  try {
    std::thread([promise, path]() {
      // faccessat is preferred over access() for security:
      // - AT_FDCWD: Use current working directory as base
      // - AT_EACCESS: Check using effective user/group IDs (not real IDs)
      //   This prevents TOCTOU attacks and privilege escalation issues
      bool accessible =
          faccessat(AT_FDCWD, path.c_str(), R_OK, AT_EACCESS) == 0;
      {
        std::lock_guard<std::mutex> lock(*g_probeMutex);
        g_inflightProbes->erase(path);
        // set_value under the same lock as erase: otherwise a concurrent
        // StartAccessProbe() for this path could observe the erased entry
        // before the value is set and spawn a redundant probe.
        promise->set_value(accessible);
      }
    }).detach();
  } catch (...) {
    // Thread construction can throw under resource exhaustion. Remove the
    // just-inserted entry (still under the lock) so later calls retry
    // instead of forever reusing a future that will never be satisfied.
    g_inflightProbes->erase(path);
    throw;
  }
  return future;
}

} // namespace

class GetVolumeMountPointsWorker : public SafeAsyncWorker {
private:
  Napi::Promise::Deferred deferred_;
  std::vector<MountPoint> mountPoints_;
  uint32_t timeoutMs_;

public:
  GetVolumeMountPointsWorker(const Napi::Promise::Deferred &deferred,
                             uint32_t timeoutMs = 5000)
      : SafeAsyncWorker(deferred.Env()), deferred_(deferred),
        timeoutMs_(timeoutMs) {}

  void Execute() override {
    DEBUG_LOG("[GetVolumeMountPointsWorker] Executing");
    if (IsShuttingDown()) {
      SetError("fs-metadata: shutdown in progress");
      return;
    }
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

      // Classify all mount points under the DA mutex, then release the
      // lock before launching async accessibility checks. This serializes
      // DiskArbitration + IOKit operations with getVolumeMetadata workers.
      std::vector<MountPoint> allMountPoints;
      {
        std::lock_guard<std::mutex> lock(g_diskArbitrationMutex);

        if (IsShuttingDown()) {
          return;
        }

        DASessionRAII session(DASessionCreate(kCFAllocatorDefault));
        if (session.isValid()) {
          static dispatch_queue_t da_queue = dispatch_queue_create(
              "com.photostructure.fs-metadata.mountpoints",
              DISPATCH_QUEUE_SERIAL);
          session.scheduleOnQueue(da_queue);
        }

        for (int j = 0; j < count; j++) {
          if (IsShuttingDown()) {
            return;
          }

          MountPoint mp;
          mp.mountPoint = mntbuf.get()[j].f_mntonname;
          mp.fstype = mntbuf.get()[j].f_fstypename;
          mp.isReadOnly = (mntbuf.get()[j].f_flags & MNT_RDONLY) != 0;

          auto classification =
              session.isValid()
                  ? ClassifyMacVolume(mntbuf.get()[j].f_mntfromname,
                                      mntbuf.get()[j].f_flags, session.get())
                  : ClassifyMacVolumeByFlags(mntbuf.get()[j].f_flags);
          mp.isSystemVolume = classification.isSystemVolume;
          mp.volumeRole = classification.role;
          mp.error = "";
          allMountPoints.push_back(std::move(mp));
        }
        // DA session RAII unschedules and releases here under the lock
      }

      // Process mount points in batches to limit concurrent threads
      const size_t maxConcurrentChecks = 4; // Limit concurrent access checks

      // One deadline for the whole probing phase, matching the per-call
      // timeoutMs contract enforced by the TypeScript wrapper — otherwise
      // each hung probe would burn its own timeoutMs and N dead mounts would
      // pin this worker for N * timeoutMs. wait_until() with an expired
      // deadline still polls, so probes that already completed report their
      // real status even after the budget is spent. (Unused when
      // timeoutMs_ == 0, which disables the timeout.)
      const auto deadline = std::chrono::steady_clock::now() +
                            std::chrono::milliseconds(timeoutMs_);

      for (size_t i = 0; i < allMountPoints.size(); i += maxConcurrentChecks) {
        if (IsShuttingDown()) {
          return;
        }

        std::vector<std::shared_future<bool>> futures;
        std::vector<MountPoint *> batchPtrs;

        // Launch async accessibility checks (no DA operations here)
        for (size_t j = i;
             j < allMountPoints.size() && j < i + maxConcurrentChecks; j++) {
          auto &mp = allMountPoints[j];

          DEBUG_LOG("[GetVolumeMountPointsWorker] Checking mount point: %s",
                    mp.mountPoint.c_str());

          batchPtrs.push_back(&mp);
          futures.push_back(StartAccessProbe(mp.mountPoint));
        }

        // Process results for this batch
        for (size_t k = 0; k < futures.size(); k++) {
          auto &mp = *batchPtrs[k];
          try {
            // timeoutMs 0 disables the timeout (see Options.timeoutMs).
            std::future_status status;
            if (timeoutMs_ == 0) {
              futures[k].wait();
              status = std::future_status::ready;
            } else {
              status = futures[k].wait_until(deadline);
            }

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
                bool isAccessible = futures[k].get();
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
        }
      }

      // Move all classified + accessibility-checked mount points to results
      mountPoints_ = std::move(allMountPoints);
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

    SafeResolve(deferred_, result);
  }

  void OnError(const Napi::Error &error) override {
    Napi::HandleScope scope(Env());
    SafeReject(deferred_, error.Value());
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
