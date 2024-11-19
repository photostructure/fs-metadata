// src/windows/fs_meta.cpp
#include "fs_meta.h"
#include <memory>
#include <string>
#include <vector>
#include <windows.h>

namespace FSMeta {

class GetVolumeMountPointsWorker : public Napi::AsyncWorker {
public:
  GetVolumeMountPointsWorker(const Napi::Promise::Deferred &deferred)
      : Napi::AsyncWorker(deferred.Env()), deferred_(deferred) {}

  void Execute() override {
    try {
      // Get required buffer size first
      DWORD length = GetLogicalDriveStringsA(0, nullptr);
      if (length == 0) {
        throw std::runtime_error("Failed to get drive strings length");
      }

      // Use vector for automatic memory management
      std::vector<char> driveStrings(length);
      if (GetLogicalDriveStringsA(length, driveStrings.data()) == 0) {
        throw std::runtime_error("Failed to get drive strings");
      }

      // Process drive strings
      for (const char *drive = driveStrings.data(); *drive;
           drive += strlen(drive) + 1) {
        mountPoints.push_back(std::string(drive));
      }

      // Enumerate network resources
      HANDLE hEnum;
      if (WNetOpenEnum(RESOURCE_CONNECTED, RESOURCETYPE_DISK, 0, nullptr,
                       &hEnum) == NO_ERROR) {
        std::vector<NETRESOURCE> buffer;
        buffer.resize(64); // Start with reasonable size

        while (true) {
          DWORD count = buffer.size();
          DWORD bufferSize = count * sizeof(NETRESOURCE);

          DWORD result =
              WNetEnumResource(hEnum, &count, buffer.data(), &bufferSize);

          if (result == ERROR_NO_MORE_ITEMS) {
            break;
          }

          if (result == ERROR_MORE_DATA) {
            buffer.resize(buffer.size() * 2);
            continue;
          }

          if (result == NO_ERROR) {
            for (DWORD i = 0; i < count; i++) {
              if (buffer[i].lpRemoteName) {
                mountPoints.push_back(std::string(buffer[i].lpRemoteName));
              }
            }
          } else {
            break; // Handle other errors
          }
        }

        WNetCloseEnum(hEnum);
      }
    } catch (const std::exception &e) {
      SetError(e.what());
    }
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    Napi::Array result = Napi::Array::New(Env());

    for (size_t i = 0; i < mountPoints.size(); i++) {
      result.Set(i, mountPoints[i]);
    }

    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error &error) override {
    deferred_.Reject(error.Value());
  }

private:
  std::vector<std::string> mountPoints;
  Napi::Promise::Deferred deferred_;
};
class GetVolumeMetadataWorker : public Napi::AsyncWorker {
public:
  GetVolumeMetadataWorker(const std::string &path,
                          const Napi::Promise::Deferred &deferred)
      : Napi::AsyncWorker(deferred.Env()), mountPoint(path),
        deferred_(deferred) {}

  void Execute() override {
    try {
      // Get volume information
      char volumeName[MAX_PATH + 1] = {0};
      char fileSystem[MAX_PATH + 1] = {0};
      DWORD serialNumber = 0;
      DWORD maxComponentLen = 0;
      DWORD fsFlags = 0;

      if (!GetVolumeInformationA(
              mountPoint.c_str(), volumeName, sizeof(volumeName), &serialNumber,
              &maxComponentLen, &fsFlags, fileSystem, sizeof(fileSystem))) {
        throw std::runtime_error("Failed to get volume information");
      }

      metadata.label = volumeName;
      metadata.fileSystem = fileSystem;

      // Get disk space information
      ULARGE_INTEGER totalBytes;
      ULARGE_INTEGER freeBytes;
      ULARGE_INTEGER totalFreeBytes;

      if (!GetDiskFreeSpaceExA(mountPoint.c_str(), &freeBytes, &totalBytes,
                               &totalFreeBytes)) {
        throw std::runtime_error("Failed to get disk space information");
      }

      metadata.size = static_cast<double>(totalBytes.QuadPart);
      metadata.available = static_cast<double>(freeBytes.QuadPart);
      metadata.used = metadata.size - metadata.available;

      // Check if drive is remote
      metadata.remote = (GetDriveTypeA(mountPoint.c_str()) == DRIVE_REMOTE);

      // Determine if volume is system partition
      char systemDrive[MAX_PATH];
      GetEnvironmentVariableA("SystemDrive", systemDrive, MAX_PATH);
      if (_stricmp(mountPoint.c_str(), systemDrive) == 0) {
        metadata.isSystemPartition = true;
      } else {
        metadata.isSystemPartition = false;
      }

      // Determine if volume is hidden partition
      DWORD attributes = GetFileAttributesA(mountPoint.c_str());
      if (attributes != INVALID_FILE_ATTRIBUTES &&
          (attributes & FILE_ATTRIBUTE_HIDDEN)) {
        metadata.isHiddenPartition = true;
      } else {
        metadata.isHiddenPartition = false;
      }

    } catch (const std::exception &e) {
      SetError(e.what());
    }
  }

  void OnOK() override {
    Napi::Object result = Napi::Object::New(Env());
    result.Set("label", metadata.label);
    result.Set("fileSystem", metadata.fileSystem);
    result.Set("size", Napi::Number::New(Env(), metadata.size));
    result.Set("used", Napi::Number::New(Env(), metadata.used));
    result.Set("available", Napi::Number::New(Env(), metadata.available));
    result.Set("remote", Napi::Boolean::New(Env(), metadata.remote));
    result.Set("isSystemPartition",
               Napi::Boolean::New(Env(), metadata.isSystemPartition));
    result.Set("isHiddenPartition",
               Napi::Boolean::New(Env(), metadata.isHiddenPartition));
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
    bool remote;
    bool isSystemPartition;
    bool isHiddenPartition;
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