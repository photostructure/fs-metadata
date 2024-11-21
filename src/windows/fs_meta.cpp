// src/windows/fs_meta.cpp

#include "fs_meta.h"
#include <iomanip>
#include <memory>
#include <sstream>
#include <string>
#include <vector>
#include <windows.h>
#include <winnetwk.h>

namespace FSMeta {
// Helper function to format UUID from volume serial number
std::string FormatVolumeUUID(DWORD serialNumber) {
  std::stringstream ss;
  ss << std::uppercase << std::hex << std::setfill('0') << std::setw(8)
     << serialNumber;
  return ss.str();
}

// New helper function to determine drive status
std::string GetDriveStatus(const std::string &path) {
  UINT driveType = GetDriveTypeA(path.c_str());

  // First check if drive is accessible
  std::string mountPoint = path;
  if (mountPoint.back() != '\\') {
    mountPoint += '\\';
  }

  // Try to get basic volume information to check if drive is responsive
  char volumeName[MAX_PATH + 1] = {0};
  char fileSystem[MAX_PATH + 1] = {0};
  DWORD serialNumber = 0;
  DWORD maxComponentLen = 0;
  DWORD fsFlags = 0;

  bool isAccessible = GetVolumeInformationA(
      mountPoint.c_str(), volumeName, sizeof(volumeName), &serialNumber,
      &maxComponentLen, &fsFlags, fileSystem, sizeof(fileSystem));

  // Determine status based on drive type and accessibility
  switch (driveType) {
  case DRIVE_UNKNOWN:
    return "unknown";
  case DRIVE_NO_ROOT_DIR:
    return "unavailable";
  case DRIVE_REMOVABLE:
    return isAccessible ? "healthy" : "disconnected";
  case DRIVE_FIXED:
    return isAccessible ? "healthy" : "error";
  case DRIVE_REMOTE:
    // For network drives, try to get connection status
    if (!isAccessible) {
      DWORD result =
          WNetGetConnectionA(path.substr(0, 2).c_str(), nullptr, nullptr);
      if (result == ERROR_NOT_CONNECTED) {
        return "disconnected";
      }
      return "error";
    }
    return "healthy";
  case DRIVE_CDROM:
    return isAccessible ? "healthy" : "no_media";
  case DRIVE_RAMDISK:
    return isAccessible ? "healthy" : "error";
  default:
    return "unknown";
  }
}
class GetVolumeMountPointsWorker : public Napi::AsyncWorker {
public:
  GetVolumeMountPointsWorker(const Napi::Promise::Deferred &deferred)
      : Napi::AsyncWorker(deferred.Env()), deferred_(deferred) {}

  void Execute() override {
    try {
      DWORD length = GetLogicalDriveStringsA(0, nullptr);
      if (length == 0) {
        DWORD error = GetLastError();
        char msg[256];
        sprintf_s(msg, "GetLogicalDriveStrings failed with error: %lu", error);
        throw std::runtime_error(msg);
      }

      std::vector<char> driveStrings(length);
      if (GetLogicalDriveStringsA(length, driveStrings.data()) == 0) {
        DWORD error = GetLastError();
        char msg[256];
        sprintf_s(msg, "GetLogicalDriveStrings data failed with error: %lu",
                  error);
        throw std::runtime_error(msg);
      }

      for (const char *drive = driveStrings.data(); *drive;
           drive += strlen(drive) + 1) {
        OutputDebugStringA(
            ("Found local drive: " + std::string(drive) + "\n").c_str());
        mountPoints.push_back(std::string(drive));
      }
    } catch (const std::exception &e) {
      SetError(e.what());
    }
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    auto result = Napi::Array::New(Env(), mountPoints.size());

    for (size_t i = 0; i < mountPoints.size(); i++) {
      result.Set(i, Napi::String::New(Env(), mountPoints[i]));
    }

    deferred_.Resolve(result);
  }

private:
  Napi::Promise::Deferred deferred_;
  std::vector<std::string> mountPoints;
};

class GetVolumeMetadataWorker : public Napi::AsyncWorker {
public:
  GetVolumeMetadataWorker(const std::string &path,
                          const Napi::Promise::Deferred &deferred)
      : Napi::AsyncWorker(deferred.Env()), mountPoint(path),
        deferred_(deferred) {}

  void Execute() override {
    try {
      // Get drive status first
      metadata.status = GetDriveStatus(mountPoint);

      // If drive is not accessible, we might want to skip further checks
      if (metadata.status == "disconnected" ||
          metadata.status == "unavailable" || metadata.status == "error" ||
          metadata.status == "no_media") {
        metadata.size = 0;
        metadata.used = 0;
        metadata.available = 0;
        return;
      }

      // Get volume information
      char volumeName[MAX_PATH + 1] = {0};
      char fileSystem[MAX_PATH + 1] = {0};
      DWORD serialNumber = 0;
      DWORD maxComponentLen = 0;
      DWORD fsFlags = 0;

      if (!GetVolumeInformationA(
              mountPoint.c_str(), volumeName, sizeof(volumeName), &serialNumber,
              &maxComponentLen, &fsFlags, fileSystem, sizeof(fileSystem))) {
        DWORD error = GetLastError();
        char msg[256];
        sprintf_s(msg,
                  "GetVolumeInformation failed with error: %lu for path: %s",
                  error, mountPoint.c_str());
        throw std::runtime_error(msg);
      }

      metadata.label = volumeName;
      metadata.fileSystem = fileSystem;
      metadata.uuid = FormatVolumeUUID(serialNumber);

      // Get disk space information
      ULARGE_INTEGER totalBytes;
      ULARGE_INTEGER freeBytes;
      ULARGE_INTEGER totalFreeBytes;

      if (!GetDiskFreeSpaceExA(mountPoint.c_str(), &freeBytes, &totalBytes,
                               &totalFreeBytes)) {
        DWORD error = GetLastError();
        char msg[256];
        sprintf_s(msg, "GetDiskFreeSpaceEx failed with error: %lu for path: %s",
                  error, mountPoint.c_str());
        throw std::runtime_error(msg);
      }

      metadata.size = static_cast<double>(totalBytes.QuadPart);
      metadata.available = static_cast<double>(freeBytes.QuadPart);
      metadata.used = metadata.size - metadata.available;

      // Check if drive is remote
      metadata.remote = (GetDriveTypeA(mountPoint.c_str()) == DRIVE_REMOTE);

      // Get network path if the drive is remote
      if (metadata.remote) {
        char remoteName[MAX_PATH] = {0};
        DWORD length = MAX_PATH;
        DWORD result = WNetGetConnectionA(mountPoint.substr(0, 2).c_str(),
                                          remoteName, &length);

        if (result == NO_ERROR) {
          metadata.mountFrom = remoteName;
        } else if (result != ERROR_NOT_CONNECTED) {
          char msg[256];
          sprintf_s(msg, "WNetGetConnection failed with error: %lu", result);
          OutputDebugStringA(msg);
        }
      }
    } catch (const std::exception &e) {
      SetError(e.what());
    }
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    Napi::Object result = Napi::Object::New(Env());

    result.Set("label", metadata.label.empty()
                            ? Env().Null()
                            : Napi::String::New(Env(), metadata.label));
    result.Set("fileSystem",
               metadata.fileSystem.empty()
                   ? Env().Null()
                   : Napi::String::New(Env(), metadata.fileSystem));
    result.Set("size", Napi::Number::New(Env(), metadata.size));
    result.Set("used", Napi::Number::New(Env(), metadata.used));
    result.Set("available", Napi::Number::New(Env(), metadata.available));
    result.Set("uuid", metadata.uuid.empty()
                           ? Env().Null()
                           : Napi::String::New(Env(), metadata.uuid));
    result.Set("remote", Napi::Boolean::New(Env(), metadata.remote));
    result.Set("status", Napi::String::New(Env(), metadata.status));

    if (metadata.remote && !metadata.mountFrom.empty()) {
      result.Set("mountFrom", Napi::String::New(Env(), metadata.mountFrom));
    }

    deferred_.Resolve(result);
  }

private:
  std::string mountPoint;
  Napi::Promise::Deferred deferred_;

  struct VolumeMetadata {
    std::string label;
    std::string fileSystem;
    double size;
    double used;
    double available;
    std::string uuid;
    std::string mountFrom;
    std::string status; // New field for drive status
    bool remote;
  } metadata;
};

Napi::Value GetVolumeMountPoints(Napi::Env env) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GetVolumeMountPointsWorker(deferred);
  worker->Queue();
  return deferred.Promise();
}

Napi::Value GetVolumeMetadata(const Napi::Env &env,
                              const std::string &mountPoint,
                              const Napi::Object &options) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GetVolumeMetadataWorker(mountPoint, deferred);
  worker->Queue();
  return deferred.Promise();
}
} // namespace FSMeta