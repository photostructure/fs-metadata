// src/windows/fs_meta.cpp
#include "fs_meta.h"

#include <windows.h>

#include <memory>
#include <string>
#include <vector>

namespace FSMeta {

class GetMountpointsWorker : public Napi::AsyncWorker {
public:
  GetMountpointsWorker(const Napi::Promise::Deferred &deferred)
      : Napi::AsyncWorker(deferred.Env()), deferred_(deferred) {}

  void Execute() override {
    try {
      DWORD drives = GetLogicalDrives();
      for (char drive = 'A'; drive <= 'Z'; drive++) {
        if (drives & (1 << (drive - 'A'))) {
          mountpoints.push_back(std::string(1, drive) + ":\\");
        }
      }
    } catch (const std::exception &e) {
      SetError(e.what());
    }
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    Napi::Array result = Napi::Array::New(Env());

    for (size_t i = 0; i < mountpoints.size(); i++) {
      result.Set(i, mountpoints[i]);
    }

    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error &error) override {
    deferred_.Reject(error.Value());
  }

private:
  std::vector<std::string> mountpoints;
  Napi::Promise::Deferred deferred_;
};

class GetVolumeMetadataWorker : public Napi::AsyncWorker {
public:
  GetVolumeMetadataWorker(const std::string &path,
                          const Napi::Promise::Deferred &deferred)
      : Napi::AsyncWorker(deferred.Env()), mountpoint(path),
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
              mountpoint.c_str(), volumeName, sizeof(volumeName), &serialNumber,
              &maxComponentLen, &fsFlags, fileSystem, sizeof(fileSystem))) {
        throw std::runtime_error("Failed to get volume information");
      }

      metadata.label = volumeName;
      metadata.filesystem = fileSystem;
      metadata.dev = serialNumber;

      // Get disk space information
      ULARGE_INTEGER totalBytes;
      ULARGE_INTEGER freeBytes;
      ULARGE_INTEGER totalFreeBytes;

      if (!GetDiskFreeSpaceExA(mountpoint.c_str(), &freeBytes, &totalBytes,
                               &totalFreeBytes)) {
        throw std::runtime_error("Failed to get disk space information");
      }

      metadata.size = static_cast<double>(totalBytes.QuadPart);
      metadata.available = static_cast<double>(totalFreeBytes.QuadPart);
      metadata.used = metadata.size - metadata.available;

      // Check if drive is remote
      metadata.remote = (GetDriveTypeA(mountpoint.c_str()) == DRIVE_REMOTE);

      // Get volume GUID
      char volumeGuid[50] = {0};
      HANDLE hVolume = FindFirstVolumeA(volumeGuid, sizeof(volumeGuid));
      if (hVolume != INVALID_HANDLE_VALUE) {
        metadata.uuid = volumeGuid;
        FindVolumeClose(hVolume);
      }
    } catch (const std::exception &e) {
      SetError(e.what());
    }
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    Napi::Object result = Napi::Object::New(Env());

    result.Set("mountpoint", mountpoint);
    result.Set("filesystem", metadata.filesystem);
    result.Set("label", metadata.label);
    result.Set("size", metadata.size);
    result.Set("used", metadata.used);
    result.Set("available", metadata.available);
    result.Set("dev", metadata.dev);
    result.Set("remote", metadata.remote);
    result.Set("uuid", metadata.uuid);

    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error &error) override {
    deferred_.Reject(error.Value());
  }

private:
  std::string mountpoint;
  Napi::Promise::Deferred deferred_;
  struct {
    std::string filesystem;
    std::string label;
    std::string uuid;
    double size;
    double used;
    double available;
    DWORD dev;
    bool remote;
  } metadata;
};

Napi::Value GetMountpoints(Napi::Env env) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GetMountpointsWorker(deferred);
  worker->Queue();
  return deferred.Promise();
}

Napi::Value GetVolumeMetadata(Napi::Env env, const std::string &mountpoint) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GetVolumeMetadataWorker(mountpoint, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta