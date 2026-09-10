// src/darwin/volume_mount_points.cpp
#include "../common/volume_mount_points.h"
#include "../common/debug_log.h"
#include "../common/error_utils.h"
#include "./da_mutex.h"
#include "./fs_meta.h"
#include "./raii_utils.h"
#include "./system_volume.h"
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <dirent.h>
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
// stuck threads without bound.
struct ProbeState {
  std::mutex mutex;
  std::condition_variable completed;
  std::uint64_t completionGeneration = 0;
  std::unordered_map<std::string, std::shared_future<bool>> inflight;
};

ProbeState *GetProbeState() {
  // Allocate lazily so allocation failure is caught by Execute(), rather than
  // throwing during addon load. Deliberately leaked: detached probe threads
  // may still access this process-lifetime state during static destruction.
  static ProbeState *const state = new ProbeState();
  return state;
}

// Returns a future answering "is path readable?", reusing any in-flight
// probe for the same path. std::async is deliberately avoided: the
// destructor of a std::async future blocks until the task finishes, so a
// hung faccessat() would pin the worker thread even after its timeout was
// reported. A promise + detached-thread pair yields futures whose
// destructors never block.
std::shared_future<bool> StartAccessProbe(const std::string &path) {
  ProbeState *const state = GetProbeState();
  std::lock_guard<std::mutex> lock(state->mutex);
  auto it = state->inflight.find(path);
  if (it != state->inflight.end()) {
    return it->second;
  }
  if (state->inflight.size() >= 64) {
    throw std::runtime_error("fs-metadata: access probe queue busy");
  }
  auto promise = std::make_shared<std::promise<bool>>();
  std::shared_future<bool> future = promise->get_future().share();
  state->inflight.emplace(path, future);
  try {
    std::thread([promise, path, state]() {
      // faccessat is preferred over access() for security:
      // - AT_FDCWD: Use current working directory as base
      // - AT_EACCESS: Check using effective user/group IDs (not real IDs)
      //   This prevents TOCTOU attacks and privilege escalation issues
      bool accessible =
          faccessat(AT_FDCWD, path.c_str(), R_OK, AT_EACCESS) == 0;
      if (accessible) {
        // Include the directory check here, on the detached probe, instead
        // of repeating opendir/closedir on Node's libuv pool afterward.
        std::unique_ptr<DIR, decltype(&closedir)> directory(
            opendir(path.c_str()), closedir);
        accessible = bool(directory);
        if (directory)
          accessible = closedir(directory.release()) == 0;
      }
      {
        std::lock_guard<std::mutex> lock(state->mutex);
        state->inflight.erase(path);
        // set_value under the same lock as erase: otherwise a concurrent
        // StartAccessProbe() for this path could observe the erased entry
        // before the value is set and spawn a redundant probe.
        promise->set_value(accessible);
        ++state->completionGeneration;
      }
      state->completed.notify_all();
    }).detach();
  } catch (...) {
    // Thread construction can throw under resource exhaustion. Remove the
    // just-inserted entry (still under the lock) so later calls retry
    // instead of forever reusing a future that will never be satisfied.
    state->inflight.erase(path);
    throw;
  }
  return future;
}

std::uint64_t ProbeCompletionGeneration() {
  ProbeState *const state = GetProbeState();
  std::lock_guard<std::mutex> lock(state->mutex);
  return state->completionGeneration;
}

bool WaitForProbeCompletionUntil(
    std::uint64_t &observedGeneration,
    const std::chrono::steady_clock::time_point &deadline) {
  ProbeState *const state = GetProbeState();
  std::unique_lock<std::mutex> lock(state->mutex);
  const bool completed = state->completed.wait_until(lock, deadline, [&]() {
    return state->completionGeneration != observedGeneration;
  });
  observedGeneration = state->completionGeneration;
  return completed;
}

} // namespace

class GetVolumeMountPointsWorker : public NativeJob {
private:
  std::vector<MountPoint> mountPoints_;
  uint32_t timeoutMs_;
  bool skipHealthProbes_;

public:
  GetVolumeMountPointsWorker(uint32_t timeoutMs = 5000,
                             bool skipHealthProbes = false)
      : NativeJob(timeoutMs), timeoutMs_(timeoutMs),
        skipHealthProbes_(skipHealthProbes) {}

  void Execute() override {
    DEBUG_LOG("[GetVolumeMountPointsWorker] Executing");
    if (IsCancelled()) {
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
        auto lock = LockDiskArbitration(*this);

        if (IsCancelled()) {
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
          if (IsCancelled()) {
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

      // Topology and path-resolution callers need only the classified mount
      // table. Do not touch every mounted path: faccessat() can remain blocked
      // on a dead network filesystem after the caller-visible timeout.
      if (skipHealthProbes_) {
        mountPoints_ = std::move(allMountPoints);
        return;
      }

      // Keep a rolling window rather than fixed batches. If one probe hangs,
      // each healthy peer that finishes immediately makes room for another
      // mount point; a hung member of an early group therefore cannot prevent
      // later healthy volumes from being checked before the deadline.
      const size_t maxConcurrentChecks = 4;

      // Reserve a quarter of the operation budget for the entire probing
      // phase, so a stalled probe can report its status before the overall
      // NativeJob deadline. Zero disables both deadlines. Poll completed
      // probes at the boundary so they retain their real status.
      const auto deadline =
          std::chrono::steady_clock::now() +
          std::chrono::milliseconds(std::max(1u, timeoutMs_ / 4));

      struct PendingProbe {
        MountPoint *mountPoint;
        std::shared_future<bool> future;
      };

      auto recordReadyProbe = [](PendingProbe &probe) {
        auto &mp = *probe.mountPoint;
        try {
          const bool isAccessible = probe.future.get();
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
          DEBUG_LOG("[GetVolumeMountPointsWorker] Exception: %s", e.what());
        }
      };

      auto recordTimedOutProbe = [](MountPoint &mp) {
        mp.status = "timeout";
        mp.error = "Access check timed out";
        DEBUG_LOG("[GetVolumeMountPointsWorker] Access check timed out: %s",
                  mp.mountPoint.c_str());
      };

      std::vector<PendingProbe> pending;
      pending.reserve(maxConcurrentChecks);
      size_t nextMountPoint = 0;
      std::uint64_t completionGeneration = ProbeCompletionGeneration();

      auto fillProbeWindow = [&]() {
        while (pending.size() < maxConcurrentChecks &&
               nextMountPoint < allMountPoints.size()) {
          auto &mp = allMountPoints[nextMountPoint++];
          DEBUG_LOG("[GetVolumeMountPointsWorker] Checking mount point: %s",
                    mp.mountPoint.c_str());
          pending.push_back(PendingProbe{&mp, StartAccessProbe(mp.mountPoint)});
        }
      };

      auto timeoutUnfinishedProbes = [&]() {
        for (auto &probe : pending) {
          recordTimedOutProbe(*probe.mountPoint);
        }
        pending.clear();
        while (nextMountPoint < allMountPoints.size()) {
          recordTimedOutProbe(allMountPoints[nextMountPoint++]);
        }
      };

      fillProbeWindow();
      while (!pending.empty()) {
        if (IsCancelled()) {
          return;
        }

        bool completedAny = false;
        for (auto it = pending.begin(); it != pending.end();) {
          if (it->future.wait_for(std::chrono::milliseconds(0)) ==
              std::future_status::ready) {
            recordReadyProbe(*it);
            it = pending.erase(it);
            completedAny = true;
          } else {
            ++it;
          }
        }

        if (completedAny) {
          if (timeoutMs_ != 0 && std::chrono::steady_clock::now() >= deadline) {
            timeoutUnfinishedProbes();
            break;
          }
          fillProbeWindow();
          continue;
        }

        // timeoutMs 0 disables the timeout (see Options.timeoutMs).
        if (timeoutMs_ == 0) {
          // Check cancellation periodically even when the user disables the
          // deadline, so Worker teardown does not strand an executor slot.
          WaitForProbeCompletionUntil(completionGeneration,
                                      std::chrono::steady_clock::now() +
                                          std::chrono::milliseconds(10));
        } else if (!WaitForProbeCompletionUntil(
                       completionGeneration,
                       std::min(deadline, std::chrono::steady_clock::now() +
                                              std::chrono::milliseconds(10))) &&
                   std::chrono::steady_clock::now() >= deadline) {
          // Poll once after the deadline so a probe that completed at the
          // boundary keeps its real status, then time out only unfinished work.
          for (auto it = pending.begin(); it != pending.end();) {
            if (it->future.wait_for(std::chrono::milliseconds(0)) ==
                std::future_status::ready) {
              recordReadyProbe(*it);
              it = pending.erase(it);
            } else {
              ++it;
            }
          }
          timeoutUnfinishedProbes();
          break;
        }
      }

      // Move all classified + accessibility-checked mount points to results
      mountPoints_ = std::move(allMountPoints);
    } catch (const std::exception &e) {
      SetError(std::string("Failed to process mount points: ") + e.what());
      DEBUG_LOG("[GetVolumeMountPointsWorker] Exception: %s", e.what());
    }
  }

  Napi::Value ToValue(Napi::Env env) override {
    auto result = Napi::Array::New(env, mountPoints_.size());

    for (size_t i = 0; i < mountPoints_.size(); i++) {
      result[i] = mountPoints_[i].ToObject(env);
    }

    return result;
  }
};

Napi::Promise GetVolumeMountPoints(const Napi::CallbackInfo &info) {
  auto env = info.Env();
  DEBUG_LOG("[GetVolumeMountPoints] called");

  MountPointOptions options;
  if (info.Length() > 0 && info[0].IsObject()) {
    options = MountPointOptions::FromObject(info[0].As<Napi::Object>());
  }

  return QueueNativeJob(env, std::make_shared<GetVolumeMountPointsWorker>(
                                 options.timeoutMs, options.skipHealthProbes));
}

} // namespace FSMeta
