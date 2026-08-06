// src/windows/volume_mount_points.cpp
#include "../common/volume_mount_points.h"
#include "../common/debug_log.h"
#include "../common/shutdown.h"
#include "drive_status.h"
#include "error_utils.h"
#include "fs_meta.h"
#include "security_utils.h"
#include "string.h"
#include "system_volume.h"
#include "windows_arch.h"
#include <iostream>
#include <sstream>
#include <vector>

namespace FSMeta {

class GetVolumeMountPointsWorker : public SafeAsyncWorker {

private:
  Napi::Promise::Deferred deferred_;
  std::vector<MountPoint> mountPoints_;
  uint32_t timeoutMs_;
  bool skipHealthProbes_;

public:
  GetVolumeMountPointsWorker(const Napi::Promise::Deferred &deferred,
                             uint32_t timeoutMs = 5000,
                             bool skipHealthProbes = false)
      : SafeAsyncWorker(deferred.Env()), deferred_(deferred),
        timeoutMs_(timeoutMs), skipHealthProbes_(skipHealthProbes) {}

  void Execute() override {
    if (IsShuttingDown()) {
      SetError("fs-metadata: shutdown in progress");
      return;
    }
    try {
      DEBUG_LOG("[GetVolumeMountPoints] getting logical drive strings size");
      DWORD size = GetLogicalDriveStringsW(0, nullptr);
      DEBUG_LOG("[GetVolumeMountPoints] logical drive strings size: %lu", size);

      if (!size) {
        throw FSException("GetLogicalDriveStrings", GetLastError());
      }

      std::vector<WCHAR> drives;
      while (true) {
        drives.resize(size);
        DEBUG_LOG("[GetVolumeMountPoints] getting logical drive strings");
        const DWORD copied = GetLogicalDriveStringsW(size, drives.data());
        if (!copied) {
          throw FSException("GetLogicalDriveStrings", GetLastError());
        }
        // The drive set can grow after the sizing call. In that case Windows
        // returns the newly required capacity, including the final null. Never
        // parse the possibly unterminated partial buffer; resize and retry.
        if (copied < size) {
          break;
        }
        size = copied;
      }

      // Internal path resolution needs only candidate drive roots, so it skips
      // GetDriveTypeW and its DRIVE_NO_ROOT_DIR filter. A root without a
      // mounted volume may remain in the list, but later device matching
      // ignores it when stat() fails.
      std::vector<std::string> paths;

      for (LPWSTR drive = drives.data(); *drive; drive += wcslen(drive) + 1) {
        DEBUG_LOG("[GetVolumeMountPoints] processing drive: %ls", drive);

        if (skipHealthProbes_) {
          paths.push_back(WideToUtf8(drive));
          continue;
        }

        UINT driveType = GetDriveTypeW(drive);
        if (driveType == DRIVE_NO_ROOT_DIR) {
          DEBUG_LOG("[GetVolumeMountPoints] skipping %ls: DRIVE_NO_ROOT_DIR",
                    drive);
          continue;
        }
        DEBUG_LOG("[GetVolumeMountPoints] drive %ls type: %u", drive,
                  driveType);

        paths.push_back(WideToUtf8(drive));
      }

      // Check all drive statuses in parallel.
      //
      // Both this and GetVolumeInformationW() below touch the volume itself, so
      // a disconnected network drive blocks here until timeoutMs_ elapses. Path
      // resolution only needs the drive letters, so it asks for neither and
      // also bypasses GetDriveTypeW() above.
      std::vector<DriveStatus> statuses;
      if (!skipHealthProbes_) {
        if (IsShuttingDown()) {
          return;
        }
        statuses = CheckDriveStatus(paths, timeoutMs_);
      }

      // Build mount points from results
      mountPoints_.reserve(paths.size());

      for (size_t i = 0; i < paths.size(); i++) {
        if (IsShuttingDown()) {
          return;
        }

        MountPoint mp;
        mp.mountPoint = paths[i];

        if (skipHealthProbes_) {
          // Path resolution reads only the mount point. status, fstype,
          // isReadOnly, and isSystemVolume are all left unset rather than
          // guessed: every one of them requires touching the volume, which is
          // the cost this mode exists to avoid. Callers that need them must
          // enumerate normally.
          //
          // This costs no network-volume filtering that existed before: a
          // mapped drive reports the *server's* filesystem (usually NTFS), so
          // skipNetworkVolumes never matched Windows network drives by fstype
          // anyway. See Options.skipNetworkVolumes.
          mp.mountPointOnly = true;
          mountPoints_.push_back(std::move(mp));
          continue;
        }

        std::wstring widePath = SecurityUtils::SafeStringToWide(paths[i]);
        mp.status = DriveStatusToString(statuses[i]);

        if (statuses[i] == DriveStatus::Healthy) {
          DWORD fsFlags = 0;
          WCHAR fsName[MAX_PATH + 1] = {0};

          if (GetVolumeInformationW(widePath.c_str(), nullptr, 0, nullptr,
                                    nullptr, &fsFlags, fsName, MAX_PATH)) {
            mp.fstype = WideToUtf8(fsName);
            mp.isReadOnly = (fsFlags & FILE_READ_ONLY_VOLUME) != 0;
            DEBUG_LOG("[GetVolumeMountPoints] drive %s filesystem: %s",
                      paths[i].c_str(), mp.fstype.c_str());
          }

          mp.isSystemVolume = IsSystemVolume(widePath);
        }
        mountPoints_.push_back(std::move(mp));
      }

      DEBUG_LOG("[GetVolumeMountPoints] found %zu mount points",
                mountPoints_.size());
    } catch (const std::exception &e) {
      DEBUG_LOG("[GetVolumeMountPoints] error: %s", e.what());
      SetError(e.what());
    }
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    auto env = Env();
    Napi::Array result = Napi::Array::New(env, mountPoints_.size());

    for (size_t i = 0; i < mountPoints_.size(); i++) {
      result[i] = mountPoints_[i].ToObject(env);
    }

    SafeResolve(deferred_, result);
  }

  void OnError(const Napi::Error &error) override {
    Napi::HandleScope scope(Env());
    SafeReject(deferred_, error.Value());
  }

}; // class GetVolumeMountPointsWorker

Napi::Promise GetVolumeMountPoints(const Napi::CallbackInfo &info) {
  auto env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);

  MountPointOptions options;
  if (info.Length() > 0 && info[0].IsObject()) {
    options = MountPointOptions::FromObject(info[0].As<Napi::Object>());
  }

  auto *worker = new GetVolumeMountPointsWorker(deferred, options.timeoutMs,
                                                options.skipHealthProbes);
  worker->Queue();
  return deferred.Promise();
}
} // namespace FSMeta
