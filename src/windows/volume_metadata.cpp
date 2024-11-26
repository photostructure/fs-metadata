// src/windows/volume_metadata.cpp
#include "../common/metadata_worker.h"
#include "error_utils.h"
#include "fs_meta.h"
#include <iomanip>
#include <sstream>
#include <windows.h>
#include <winnetwk.h>

namespace FSMeta
{

  inline std::string FormatVolumeUUID(DWORD serialNumber)
  {
    std::stringstream ss;
    ss << std::uppercase << std::hex << std::setfill('0') << std::setw(8)
       << serialNumber;
    return ss.str();
  }

  inline void ValidatePath(const std::string &path)
  {
    if (path.empty() || path.length() >= MAX_PATH)
    {
      throw FSException("Invalid path length");
    }
  }

  // Drive status determination with performance optimization
  DriveStatus GetDriveStatus(const std::string &path)
  {
    UINT driveType = GetDriveTypeA(path.c_str());

    // First check if drive is accessible
    std::string mountPoint = path;
    if (mountPoint.back() != '\\')
    {
      mountPoint += '\\';
    }

    // Use stack-allocated arrays for better performance
    char volumeName[BUFFER_SIZE] = {0};
    char fileSystem[BUFFER_SIZE] = {0};
    DWORD serialNumber = 0;
    DWORD maxComponentLen = 0;
    DWORD fsFlags = 0;

    bool isAccessible = GetVolumeInformationA(
        mountPoint.c_str(), volumeName, BUFFER_SIZE, &serialNumber,
        &maxComponentLen, &fsFlags, fileSystem, BUFFER_SIZE);

    switch (driveType)
    {
    case DRIVE_UNKNOWN:
      return Unknown;
    case DRIVE_NO_ROOT_DIR:
      return Unavailable;
    case DRIVE_REMOVABLE:
      return isAccessible ? Healthy : Disconnected;
    case DRIVE_FIXED:
      return isAccessible ? Healthy : Error;
    case DRIVE_REMOTE:
      if (!isAccessible)
      {
        DWORD result =
            WNetGetConnectionA(path.substr(0, 2).c_str(), nullptr, nullptr);
        return (result == ERROR_NOT_CONNECTED) ? Disconnected : Error;
      }
      return Healthy;
    case DRIVE_CDROM:
      return isAccessible ? Healthy : NoMedia;
    case DRIVE_RAMDISK:
      return isAccessible ? Healthy : Error;
    default:
      return Unknown;
    }
  }

  class GetVolumeMetadataWorker : public FSMeta::MetadataWorkerBase
  {
  public:
    GetVolumeMetadataWorker(const std::string &mountPoint,
                            const Napi::Promise::Deferred &deferred)
        : MetadataWorkerBase(mountPoint, deferred)
    {
      ValidatePath(mountPoint);
    }

    void Execute() override
    {
      try
      {
        // Get drive status first
        DriveStatus status = GetDriveStatus(mountPoint);
        metadata.status = DriveStatusToString(status);

        // If drive is not accessible, skip further checks
        if (status == Disconnected || status == Unavailable || status == Error ||
            status == NoMedia)
        {
          throw FSException("Unhealthy drive status: " +
                            std::string(metadata.status));
        }

        // Use stack-allocated arrays for better performance
        char volumeName[BUFFER_SIZE] = {0};
        char fileSystem[BUFFER_SIZE] = {0};
        DWORD serialNumber = 0;
        DWORD maxComponentLen = 0;
        DWORD fsFlags = 0;

        if (!GetVolumeInformationA(mountPoint.c_str(), volumeName, BUFFER_SIZE,
                                   &serialNumber, &maxComponentLen, &fsFlags,
                                   fileSystem, BUFFER_SIZE))
        {
          throw FSException("GetVolumeInformation", GetLastError());
        }

        metadata.label = volumeName;
        metadata.fileSystem = fileSystem;
        metadata.uuid = FormatVolumeUUID(serialNumber);

        // Get disk space information
        ULARGE_INTEGER totalBytes;
        ULARGE_INTEGER freeBytes;
        ULARGE_INTEGER totalFreeBytes;

        if (!GetDiskFreeSpaceExA(mountPoint.c_str(), &freeBytes, &totalBytes,
                                 &totalFreeBytes))
        {
          throw FSException("GetDiskFreeSpaceEx", GetLastError());
        }

        metadata.size = static_cast<double>(totalBytes.QuadPart);
        metadata.available = static_cast<double>(freeBytes.QuadPart);
        metadata.used = metadata.size - metadata.available;

        // Check if drive is remote
        metadata.remote = (GetDriveTypeA(mountPoint.c_str()) == DRIVE_REMOTE);

        // Get network path if the drive is remote
        if (metadata.remote)
        {
          char remoteName[BUFFER_SIZE] = {0};
          DWORD length = BUFFER_SIZE;
          DWORD result = WNetGetConnectionA(mountPoint.substr(0, 2).c_str(),
                                            remoteName, &length);

          if (result == NO_ERROR)
          {
            metadata.mountFrom = remoteName;
          }
        }
      }
      catch (const std::exception &e)
      {
        SetError(e.what());
      }
    }
  }; // class GetVolumeMetadataWorker

  Napi::Value
  GetVolumeMetadata(const Napi::Env &env,
                    const std::string &mountPoint,
                    const Napi::Object &options)
  {
    auto deferred = Napi::Promise::Deferred::New(env);
    auto *worker = new GetVolumeMetadataWorker(mountPoint, deferred);
    worker->Queue();
    return deferred.Promise();
  }

} // namespace FSMeta