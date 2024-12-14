// src/windows/volume_mount_points.cpp
#include "../common/volume_mount_points.h"
#include "../common/debug_log.h"
#include "../common/error_utils.h"
#include "drive_status.h"
#include "fs_meta.h"
#include "string.h"
#include "system_volume.h"
#include <iostream>
#include <memory>
#include <sstream>
#include <vector>
#include <windows.h>

namespace FSMeta {

struct DriveStringsBuffer {
  std::unique_ptr<WCHAR[]> buffer;
  explicit DriveStringsBuffer(DWORD size)
      : buffer(std::make_unique<WCHAR[]>(size)) {}
};

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
      DEBUG_LOG("[GetVolumeMountPoints] getting logical drive strings size");
      DWORD size = GetLogicalDriveStringsW(0, nullptr);
      DEBUG_LOG("[GetVolumeMountPoints] logical drive strings size: %lu", size);

      if (!size) {
        throw FSException(
            CreateErrorMessage("GetLogicalDriveStrings", GetLastError()));
      }

      DriveStringsBuffer drives(size);
      DEBUG_LOG("[GetVolumeMountPoints] getting logical drive strings");
      if (!GetLogicalDriveStringsW(size, drives.buffer.get())) {
        throw FSException(
            CreateErrorMessage("GetLogicalDriveStrings", GetLastError()));
      }

      // First collect all valid drives and their types
      std::vector<std::string> paths;
      std::vector<UINT> driveTypes;

      for (LPWSTR drive = drives.buffer.get(); *drive;
           drive += wcslen(drive) + 1) {
        DEBUG_LOG("[GetVolumeMountPoints] processing drive: %ls", drive);

        UINT driveType = GetDriveTypeW(drive);
        if (driveType == DRIVE_NO_ROOT_DIR) {
          DEBUG_LOG("[GetVolumeMountPoints] skipping %ls: DRIVE_NO_ROOT_DIR",
                    drive);
          continue;
        }
        DEBUG_LOG("[GetVolumeMountPoints] drive %ls type: %u", drive,
                  driveType);

        paths.push_back(WideToUtf8(drive));
        driveTypes.push_back(driveType);
      }

      // Check all drive statuses in parallel
      auto statuses = CheckDriveStatus(paths, timeoutMs_);

      // Build mount points from results
      mountPoints_.reserve(paths.size());

      for (size_t i = 0; i < paths.size(); i++) {
        MountPoint mp;
        mp.mountPoint = paths[i];
        mp.status = DriveStatusToString(statuses[i]);

        if (statuses[i] == DriveStatus::Healthy) {
          WCHAR fsName[MAX_PATH + 1] = {0};
          std::wstring widePath(paths[i].begin(), paths[i].end());

          if (GetVolumeInformationW(widePath.c_str(), nullptr, 0, nullptr,
                                    nullptr, nullptr, fsName, MAX_PATH)) {
            mp.fstype = WideToUtf8(fsName);
            DEBUG_LOG("[GetVolumeMountPoints] drive %s filesystem: %s",
                      paths[i].c_str(), mp.fstype.c_str());
          }
        }

        // Convert path to wide string before calling IsSystemVolume
        std::wstring widePath(paths[i].begin(), paths[i].end());
        mp.isSystemVolume = IsSystemVolume(widePath);
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
    auto env = Env();
    Napi::Array result = Napi::Array::New(env, mountPoints_.size());

    for (size_t i = 0; i < mountPoints_.size(); i++) {
      result[i] = mountPoints_[i].ToObject(env);
    }

    deferred_.Resolve(result);
  }

}; // class GetVolumeMountPointsWorker

Napi::Promise GetVolumeMountPoints(const Napi::CallbackInfo &info) {
  auto env = info.Env();
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