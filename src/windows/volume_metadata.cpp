// src/windows/volume_metadata.cpp
#include "../common/debug_log.h"
#include "../common/metadata_worker.h"
#include "drive_status.h"
#include "error_utils.h"
#include "fs_meta.h"
#include "security_utils.h"
#include "string.h"
#include "system_volume.h"
#include <iomanip>
#include <memory>
#include <sstream>
#include <vector>
#include <winnetwk.h>

namespace FSMeta {

namespace {
// Wrapper for WNet connection lookups.
//
// W APIs are used throughout this file: JS strings are UTF-8, but the A
// variants interpret bytes in the active ANSI code page, which mangles or
// rejects non-ANSI paths, labels, and share names.
class WNetConnection {
  std::string remotePath_;
  bool isValid = false;

public:
  explicit WNetConnection(const std::string &path) {
    std::wstring drivePath = SecurityUtils::SafeStringToWide(path.substr(0, 2));
    DWORD bufferSize = MAX_PATH;
    std::vector<WCHAR> buffer(bufferSize);

    DWORD result =
        WNetGetConnectionW(drivePath.c_str(), buffer.data(), &bufferSize);

    if (result == ERROR_MORE_DATA) {
      // bufferSize now contains the required size in WCHARs
      buffer.resize(bufferSize);
      result =
          WNetGetConnectionW(drivePath.c_str(), buffer.data(), &bufferSize);
    }

    isValid = (result == NO_ERROR);
    if (isValid) {
      remotePath_ = WideToUtf8(buffer.data());
    }
  }

  bool valid() const { return isValid; }
  const std::string &remotePath() const { return remotePath_; }
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

  // Volume GUID paths have the format "\\?\Volume{GUID}\".
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
  std::string volumeName_;
  std::string fstype_;
  DWORD serialNumber = 0;
  DWORD maxComponentLen = 0;
  DWORD fsFlags = 0;
  bool valid = false;

public:
  explicit VolumeInfo(const std::wstring &mountPoint) {
    // Initialize buffers to prevent reading uninitialized memory if
    // GetVolumeInformationW fails with ERROR_NOT_READY
    WCHAR volumeName[VOLUME_NAME_SIZE] = {0};
    WCHAR fstype[VOLUME_NAME_SIZE] = {0};

    valid = GetVolumeInformationW(
        mountPoint.c_str(), volumeName, VOLUME_NAME_SIZE, &serialNumber,
        &maxComponentLen, &fsFlags, fstype, VOLUME_NAME_SIZE);

    if (!valid && GetLastError() != ERROR_NOT_READY) {
      throw FSException("GetVolumeInformation", GetLastError());
    }
    if (valid) {
      volumeName_ = WideToUtf8(volumeName);
      fstype_ = WideToUtf8(fstype);
    }
  }

  bool isValid() const { return valid; }
  const std::string &getVolumeName() const { return volumeName_; }
  const std::string &getFileSystem() const { return fstype_; }
  DWORD getSerialNumber() const { return serialNumber; }
  DWORD getFlags() const { return fsFlags; }
};

// RAII wrapper for disk space information
class DiskSpaceInfo {
  // Initialize all members to prevent reading uninitialized memory
  // if GetDiskFreeSpaceExW fails with ERROR_NOT_READY
  ULARGE_INTEGER totalBytes = {0};
  ULARGE_INTEGER freeBytes = {0};
  ULARGE_INTEGER totalFreeBytes = {0};
  bool valid = false;

public:
  explicit DiskSpaceInfo(const std::wstring &mountPoint) {
    valid = GetDiskFreeSpaceExW(mountPoint.c_str(), &freeBytes, &totalBytes,
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
    if (IsShuttingDown()) {
      SetError("fs-metadata: shutdown in progress");
      return;
    }
    try {
      // Get drive status first
      DriveStatus status = CheckDriveStatus(mountPoint, options_.timeoutMs);
      metadata.status = DriveStatusToString(status);

      if (status != DriveStatus::Healthy) {
        DEBUG_LOG(
            "[GetVolumeMetadata] %s not healthy, skipping additional info",
            mountPoint.c_str());
        return; // Don't try to get additional info for non-healthy drives
      }

      // Convert the UTF-8 mount point to wide chars once; the W APIs are
      // used throughout (see the WNetConnection comment).
      std::wstring widePath = SecurityUtils::SafeStringToWide(mountPoint);

      VolumeInfo volInfo(widePath);
      if (volInfo.isValid()) {
        metadata.label = volInfo.getVolumeName();
        metadata.fstype = volInfo.getFileSystem();
        metadata.isReadOnly = (volInfo.getFlags() & FILE_READ_ONLY_VOLUME) != 0;
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
        DiskSpaceInfo diskInfo(widePath);
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

      metadata.isSystemVolume = IsSystemVolume(widePath);

      DEBUG_LOG("[GetVolumeMetadata] %s {isSystemVolume: %s}",
                mountPoint.c_str(), metadata.isSystemVolume ? "true" : "false");

      // Check if drive is remote
      metadata.remote = (GetDriveTypeW(widePath.c_str()) == DRIVE_REMOTE);
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

  // Reject bad input with a JS TypeError before constructing the worker: a
  // plain C++ exception thrown from this function is not translated by
  // node-addon-api and aborts the process.
  if (info.Length() < 1 || !info[0].IsObject()) {
    throw Napi::TypeError::New(env, "Expected options object with mountPoint");
  }
  auto options = VolumeMetadataOptions::FromObject(info[0].As<Napi::Object>());

  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker =
      new GetVolumeMetadataWorker(options.mountPoint, options, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta
