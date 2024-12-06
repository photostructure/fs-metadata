// src/windows/volume_mount_points.cpp
#include "../common/volume_mount_points.h"
#include "../common/error_utils.h"
#include "fs_meta.h"
#include "string.h"
#include <memory>
#include <vector>
#include <windows.h>

namespace FSMeta {

namespace {
struct DriveStringsBuffer {
  std::unique_ptr<WCHAR[]> buffer;
  explicit DriveStringsBuffer(DWORD size)
      : buffer(std::make_unique<WCHAR[]>(size)) {}
};
} // namespace

class GetVolumeMountPointsWorker : public Napi::AsyncWorker {
public:
  GetVolumeMountPointsWorker(const Napi::Promise::Deferred &deferred)
      : Napi::AsyncWorker(deferred.Env()), deferred_(deferred) {}

  void Execute() override {
    try {
      DWORD size = GetLogicalDriveStringsW(0, nullptr);
      if (!size) {
        throw FSException(
            CreateErrorMessage("GetLogicalDriveStrings", GetLastError()));
      }

      DriveStringsBuffer drives(size);
      if (!GetLogicalDriveStringsW(size, drives.buffer.get())) {
        throw FSException(
            CreateErrorMessage("GetLogicalDriveStrings", GetLastError()));
      }

      WCHAR winDir[MAX_PATH + 1] = {0};
      GetWindowsDirectoryW(winDir, MAX_PATH);

      for (LPWSTR drive = drives.buffer.get(); *drive;
           drive += wcslen(drive) + 1) {
        UINT driveType = GetDriveTypeW(drive);
        if (driveType == DRIVE_NO_ROOT_DIR) {
          continue;
        }

        MountPoint mp;
        mp.mountPoint = WideToUtf8(drive);

        WCHAR fsName[MAX_PATH + 1] = {0};
        if (GetVolumeInformationW(drive, nullptr, 0, nullptr, nullptr, nullptr,
                                  fsName, MAX_PATH)) {
          mp.fstype = WideToUtf8(fsName);
        }

        mp.status = GetVolumeHealthStatus(driveType);

        std::wstring drivePath(drive);
        std::wstring winDirStr(winDir);
        mp.isSystemVolume = (mp.fstype == "System" || mp.fstype == "Reserved" ||
                             mp.fstype == "Recovery");

        mountPoints_.push_back(std::move(mp));
      }
    } catch (const std::exception &e) {
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

private:
  Napi::Promise::Deferred deferred_;
  std::vector<MountPoint> mountPoints_;

  static std::string GetVolumeHealthStatus(UINT type) {
    switch (type) {
    case DRIVE_REMOVABLE:
    case DRIVE_FIXED:
    case DRIVE_CDROM:
    case DRIVE_RAMDISK:
      return "healthy";
    case DRIVE_REMOTE:
      return "disconnected";
    case DRIVE_UNKNOWN:
    case DRIVE_NO_ROOT_DIR:
    default:
      return "unknown";
    }
  }
};

Napi::Promise GetVolumeMountPoints(const Napi::CallbackInfo &info) {
  auto deferred = Napi::Promise::Deferred::New(info.Env());
  auto *worker = new GetVolumeMountPointsWorker(deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta