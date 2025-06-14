// src/windows/volume_metadata.cpp
#include "windows_common.h"
#include "../common/debug_log.h"
#include "../common/metadata_worker.h"
#include "drive_status.h"
#include "error_utils.h"
#include "fs_meta.h"
#include "memory_debug.h"
#include "security_utils.h"
#include "string.h"
#include "system_volume.h"
#include <iomanip>
#include <memory>
#include <sstream>
#include <windows.h>
#include <winnetwk.h>

namespace FSMeta {

namespace {
// RAII wrapper for WNet connections
class WNetConnection {
  std::string drivePath;
  std::unique_ptr<char[]> buffer;
  DWORD bufferSize;
  bool isValid = false;

public:
  explicit WNetConnection(const std::string &path)
      : drivePath(path.substr(0, 2)), bufferSize(MAX_PATH) {

    // Allocate initial buffer
    buffer = std::make_unique<char[]>(bufferSize);

    DWORD result =
        WNetGetConnectionA(drivePath.c_str(), buffer.get(), &bufferSize);

    if (result == ERROR_MORE_DATA) {
      // bufferSize now contains the required size
      buffer = std::make_unique<char[]>(bufferSize);
      result = WNetGetConnectionA(drivePath.c_str(), buffer.get(), &bufferSize);
    }

    isValid = (result == NO_ERROR);
  }

  WNetConnection(WNetConnection &&) noexcept = default;
  WNetConnection &operator=(WNetConnection &&) noexcept = default;

  // Prevent copying
  WNetConnection(const WNetConnection &) = delete;
  WNetConnection &operator=(const WNetConnection &) = delete;

  bool valid() const { return isValid; }
  const char *remotePath() const { return buffer.get(); }
};

// Helper for formatting volume serialNumber
inline std::string FormatVolumeSerialNumber(DWORD serialNumber) {
  std::stringstream ss;
  // We aren't using std::uppercase here because volume UUIDs aren't coming
  // out uppercase either.
  ss << std::hex << std::setfill('0') << std::setw(8) << serialNumber;
  return ss.str();
}

// Helper for getting volume GUID path
inline std::string GetVolumeGUID(const std::string &mountPoint) {
  std::wstring widePath = SecurityUtils::SafeStringToWide(mountPoint);
  if (widePath.back() != L'\\') {
    widePath += L'\\';
  }

  // Volume GUID paths have format: \\?\Volume{GUID}\ 
  // Maximum length is 49 characters + null terminator
  constexpr DWORD VOLUME_GUID_PATH_LENGTH = 50;
  WCHAR volumeGUID[VOLUME_GUID_PATH_LENGTH] = {0};

  if (!GetVolumeNameForVolumeMountPointW(widePath.c_str(), volumeGUID,
                                         VOLUME_GUID_PATH_LENGTH)) {
    throw FSException("GetVolumeNameForVolumeMountPoint", GetLastError());
  }

  // Convert GUID to string
  return WideToUtf8(volumeGUID);
}

// RAII wrapper for volume information
class VolumeInfo {
  static constexpr DWORD VOLUME_NAME_SIZE = MAX_PATH + 1; // 261 characters
  char volumeName[VOLUME_NAME_SIZE];
  char fstype[VOLUME_NAME_SIZE];
  DWORD serialNumber;
  DWORD maxComponentLen;
  DWORD fsFlags;
  bool valid;

public:
  explicit VolumeInfo(const std::string &mountPoint) {
    valid = GetVolumeInformationA(
        mountPoint.c_str(), volumeName, VOLUME_NAME_SIZE, &serialNumber,
        &maxComponentLen, &fsFlags, fstype, VOLUME_NAME_SIZE);

    if (!valid && GetLastError() != ERROR_NOT_READY) {
      throw FSException("GetVolumeInformation", GetLastError());
    }
  }

  bool isValid() const { return valid; }
  const char *getVolumeName() const { return volumeName; }
  const char *getFileSystem() const { return fstype; }
  DWORD getSerialNumber() const { return serialNumber; }
};

// RAII wrapper for disk space information
class DiskSpaceInfo {
  ULARGE_INTEGER totalBytes;
  ULARGE_INTEGER freeBytes;
  ULARGE_INTEGER totalFreeBytes;
  bool valid;

public:
  explicit DiskSpaceInfo(const std::string &mountPoint) {
    valid = GetDiskFreeSpaceExA(mountPoint.c_str(), &freeBytes, &totalBytes,
                                &totalFreeBytes);

    if (!valid && GetLastError() != ERROR_NOT_READY) {
      throw FSException("GetDiskFreeSpaceEx", GetLastError());
    }
  }

  bool isValid() const { return valid; }
  double getTotalBytes() const {
    return static_cast<double>(totalBytes.QuadPart);
  }
  double getFreeBytes() const {
    return static_cast<double>(freeBytes.QuadPart);
  }
};

} // anonymous namespace

class GetVolumeMetadataWorker : public MetadataWorkerBase {
public:
  GetVolumeMetadataWorker(const std::string &mountPoint,
                          const VolumeMetadataOptions &options,
                          const Napi::Promise::Deferred &deferred)
      : MetadataWorkerBase(mountPoint, deferred), options_(options) {}

private:
  VolumeMetadataOptions options_;

  void Execute() override {
    try {
      MEMORY_CHECKPOINT("GetVolumeMetadataWorker::Execute");

      // Get drive status first
      DriveStatus status = CheckDriveStatus(mountPoint);
      metadata.status = DriveStatusToString(status);

      if (status != DriveStatus::Healthy) {
        DEBUG_LOG(
            "[GetVolumeMetadata] %s not healthy, skipping additional info",
            mountPoint.c_str());
        return; // Don't try to get additional info for non-healthy drives
      }

      std::wstring widePath = SecurityUtils::SafeStringToWide(mountPoint);
      metadata.isSystemVolume = IsSystemVolume(widePath.c_str());

      DEBUG_LOG("[GetVolumeMetadata] %s {isSystemVolume: %s}",
                mountPoint.c_str(), metadata.isSystemVolume ? "true" : "false");

      // Get volume information
      VolumeInfo volInfo(mountPoint);
      if (volInfo.isValid()) {
        metadata.label = volInfo.getVolumeName();
        metadata.fstype = volInfo.getFileSystem();
        DEBUG_LOG("[GetVolumeMetadata] %s {label: %s, fstype: %s}",
                  mountPoint.c_str(), metadata.label.c_str(),
                  metadata.fstype.c_str());

        try {
          metadata.uuid = GetVolumeGUID(mountPoint);
          DEBUG_LOG("[GetVolumeMetadata] %s GetVolumeGUID(): {uuid: %s}",
                    mountPoint.c_str(), metadata.uuid.c_str());
        } catch (const FSException &e) {
          DEBUG_LOG("[GetVolumeMetadata] %s GetVolumeGUID() failed: %s",
                    mountPoint.c_str(), e.what());
          metadata.uuid = FormatVolumeSerialNumber(volInfo.getSerialNumber());
          DEBUG_LOG("[GetVolumeMetadata] %s Backfilling UUID with "
                    "lpVolumeSerialNumber %d {uuid: %s}",
                    mountPoint.c_str(), volInfo.getSerialNumber(),
                    metadata.uuid.c_str());
        }

        // Get disk space information
        DiskSpaceInfo diskInfo(mountPoint);
        if (diskInfo.isValid()) {
          metadata.size = diskInfo.getTotalBytes();
          metadata.available = diskInfo.getFreeBytes();
          metadata.used = metadata.size - metadata.available;
          DEBUG_LOG(
              "[GetVolumeMetadata] %s {size: %.3f GB, available: %.3f GB}",
              mountPoint.c_str(), metadata.size / 1e9,
              metadata.available / 1e9);
        }
      }

      // Check if drive is remote
      metadata.remote = (GetDriveTypeA(mountPoint.c_str()) == DRIVE_REMOTE);
      DEBUG_LOG("[GetVolumeMetadata] %s {remote: %s}", mountPoint.c_str(),
                metadata.remote ? "true" : "false");

      if (metadata.remote) {
        WNetConnection conn(mountPoint);
        if (conn.valid()) {
          metadata.mountFrom = conn.remotePath();
          DEBUG_LOG("[GetVolumeMetadata] %s {mountFrom: %s}",
                    mountPoint.c_str(), metadata.mountFrom.c_str());
        }
      }
    } catch (const std::exception &e) {
      DEBUG_LOG("[GetVolumeMetadata] %s error: %s", mountPoint.c_str(),
                e.what());
      SetError(e.what());
    }
  }
}; // class GetVolumeMetadataWorker

Napi::Value GetVolumeMetadata(const Napi::CallbackInfo &info) {
  auto env = info.Env();

  // Parse options using FromObject
  VolumeMetadataOptions options;
  if (info.Length() > 0 && info[0].IsObject()) {
    options = VolumeMetadataOptions::FromObject(info[0].As<Napi::Object>());
  }

  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker =
      new GetVolumeMetadataWorker(options.mountPoint, options, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta