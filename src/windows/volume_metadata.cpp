// volume_metadata.cpp
#include "../common/metadata_worker.h"
#include "error_utils.h"
#include "fs_meta.h"
#include "string.h"
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
      : drivePath(path.substr(0, 2)), bufferSize(BUFFER_SIZE),
        buffer(std::make_unique<char[]>(BUFFER_SIZE)) {

    DWORD result =
        WNetGetConnectionA(drivePath.c_str(), buffer.get(), &bufferSize);
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
  std::wstring widePath(mountPoint.begin(), mountPoint.end());
  if (widePath.back() != L'\\') {
    widePath += L'\\';
  }

  WCHAR volumeGUID[50] = {0}; // Sufficient size for a GUID path
  if (!GetVolumeNameForVolumeMountPointW(widePath.c_str(), volumeGUID, 50)) {
    throw FSException("GetVolumeNameForVolumeMountPoint", GetLastError());
  }

  // Convert GUID to string and trim the trailing slash
  return WideToUtf8(volumeGUID);
}

// RAII wrapper for volume information
class VolumeInfo {
  char volumeName[BUFFER_SIZE];
  char fstype[BUFFER_SIZE];
  DWORD serialNumber;
  DWORD maxComponentLen;
  DWORD fsFlags;
  bool valid;

public:
  explicit VolumeInfo(const std::string &mountPoint) {
    valid = GetVolumeInformationA(mountPoint.c_str(), volumeName, BUFFER_SIZE,
                                  &serialNumber, &maxComponentLen, &fsFlags,
                                  fstype, BUFFER_SIZE);

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

void ValidatePath(const std::string &path) {
  if (path.empty() || path.length() >= MAX_PATH) {
    throw FSException("Invalid path length");
  }
}

// Enhanced drive status determination
DriveStatus GetDriveStatus(const std::string &path) {
  UINT driveType = GetDriveTypeA(path.c_str());

  std::string mountPoint = path;
  if (mountPoint.back() != '\\') {
    mountPoint += '\\';
  }

  try {
    VolumeInfo volInfo(mountPoint);
    if (volInfo.isValid()) {
      return Healthy;
    }

    // Handle special cases based on drive type
    switch (driveType) {
    case DRIVE_REMOVABLE:
      return Disconnected;
    case DRIVE_FIXED:
      return Error;
    case DRIVE_REMOTE: {
      WNetConnection conn(path);
      return (conn.valid()) ? Healthy : Disconnected;
    }
    case DRIVE_CDROM:
      return NoMedia;
    case DRIVE_RAMDISK:
      return Error;
    case DRIVE_UNKNOWN:
      return Unknown;
    case DRIVE_NO_ROOT_DIR:
      return Unavailable;
    default:
      return Unknown;
    }
  } catch (const FSException &) {
    return Error;
  }
}

} // anonymous namespace

class GetVolumeMetadataWorker : public FSMeta::MetadataWorkerBase {
public:
  GetVolumeMetadataWorker(const std::string &mountPoint,
                          const Napi::Promise::Deferred &deferred)
      : MetadataWorkerBase(mountPoint, deferred) {
    ValidatePath(mountPoint);
  }

  void Execute() override {
    try {
      std::string normalizedPath = mountPoint;
      if (normalizedPath.back() != '\\') {
        normalizedPath += '\\';
      }

      // Get drive status first
      DriveStatus status = GetDriveStatus(mountPoint);
      metadata.status = DriveStatusToString(status);

      if (status == Disconnected || status == Unavailable || status == Error ||
          status == NoMedia) {
        return;
      }

      // Get volume information
      VolumeInfo volInfo(normalizedPath);
      if (volInfo.isValid()) {
        metadata.label = volInfo.getVolumeName();
        metadata.fstype = volInfo.getFileSystem();

        // Get volume GUID instead of using serial number
        try {
          metadata.uuid = GetVolumeGUID(normalizedPath);
        } catch (const FSException &) {
          // If getting GUID fails, fall back to serial number (it's probably
          // a remote volume)
          metadata.uuid = FormatVolumeSerialNumber(volInfo.getSerialNumber());
        }

        // Get disk space information
        DiskSpaceInfo diskInfo(normalizedPath);
        if (diskInfo.isValid()) {
          metadata.size = diskInfo.getTotalBytes();
          metadata.available = diskInfo.getFreeBytes();
          metadata.used = metadata.size - metadata.available;
        }
      }

      // Check if drive is remote
      metadata.remote = (GetDriveTypeA(normalizedPath.c_str()) == DRIVE_REMOTE);

      if (metadata.remote) {
        WNetConnection conn(mountPoint);
        if (conn.valid()) {
          metadata.mountFrom = conn.remotePath();
        }
      }
    } catch (const std::exception &e) {
      SetError(e.what());
    }
  }
}; // class GetVolumeMetadataWorker

Napi::Value GetVolumeMetadata(const Napi::Env &env,
                              const std::string &mountPoint,
                              const Napi::Object &options) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GetVolumeMetadataWorker(mountPoint, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta