// src/darwin/fs_meta.cpp

#include "fs_meta.h"

#include <CoreFoundation/CoreFoundation.h>
#include <DiskArbitration/DiskArbitration.h>
#include <IOKit/IOBSD.h>
#include <IOKit/storage/IOMedia.h>
#include <IOKit/storage/IOStorageProtocolCharacteristics.h>
#include <sys/mount.h>
#include <sys/param.h>
#include <sys/statvfs.h>
#include <vector>

namespace FSMeta {

// Helper function to convert CFString to std::string
static std::string CFStringToString(CFStringRef cfString) {
  if (!cfString)
    return "";

  CFIndex length = CFStringGetLength(cfString);
  CFIndex maxSize =
      CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
  std::string result(maxSize, '\0');

  if (!CFStringGetCString(cfString, &result[0], maxSize,
                         kCFStringEncodingUTF8)) {
    return "";
  }

  result.resize(strlen(result.c_str()));
  return result;
}

class GetVolumeMountPointsWorker : public Napi::AsyncWorker {
public:
  GetVolumeMountPointsWorker(const Napi::Promise::Deferred& deferred)
      : Napi::AsyncWorker(deferred.Env()), deferred_(deferred) {}

  void Execute() override {
    try {
      struct statfs* mntbufp;
      int count = getmntinfo(&mntbufp, MNT_WAIT);

      if (count <= 0) {
        throw std::runtime_error("Failed to get mount information");
      }

      for (int i = 0; i < count; i++) {
        MountPoint point;
        point.mountPoint = mntbufp[i].f_mntonname;
        point.fsType = mntbufp[i].f_fstypename;
        mountPoints.push_back(point);
      }
    } catch (const std::exception& e) {
      SetError(e.what());
    }
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    Napi::Array result = Napi::Array::New(Env());

    for (size_t i = 0; i < mountPoints.size(); i++) {
      Napi::Object point = Napi::Object::New(Env());
      point.Set("mountPoint", mountPoints[i].mountPoint);
      point.Set("fstype", mountPoints[i].fsType);
      result.Set(i, point);
    }

    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& error) override {
    deferred_.Reject(error.Value());
  }

private:
  struct MountPoint {
    std::string mountPoint;
    std::string fsType;
  };
  std::vector<MountPoint> mountPoints;
  Napi::Promise::Deferred deferred_;
};

class GetVolumeMetadataWorker : public Napi::AsyncWorker {
public:
  GetVolumeMetadataWorker(const std::string& path,
                         const Napi::Promise::Deferred& deferred)
      : Napi::AsyncWorker(deferred.Env()),
        mountPoint(path),
        deferred_(deferred) {}

  void Execute() override {
    try {
      struct statvfs vfs;
      struct statfs fs;

      // Get basic volume information using statvfs
      if (statvfs(mountPoint.c_str(), &vfs) != 0) {
        throw std::runtime_error("Failed to get volume statistics");
      }

      // Get additional information using statfs
      if (statfs(mountPoint.c_str(), &fs) != 0) {
        throw std::runtime_error("Failed to get file system information");
      }

      // Store basic volume information
      metadata.fileSystem = fs.f_fstypename;
      metadata.size = static_cast<double>(vfs.f_blocks) * vfs.f_frsize;
      metadata.used = static_cast<double>(vfs.f_blocks - vfs.f_bfree) * vfs.f_frsize;
      metadata.available = static_cast<double>(vfs.f_bavail) * vfs.f_frsize;

      // Get additional information using DiskArbitration framework
      DASessionRef session = DASessionCreate(kCFAllocatorDefault);
      if (!session) {
        throw std::runtime_error("Failed to create DiskArbitration session");
      }

      DADiskRef disk =
          DADiskCreateFromBSDName(kCFAllocatorDefault, session, fs.f_mntfromname);
      
      if (disk) {
        CFDictionaryRef description = DADiskCopyDescription(disk);
        if (description) {
          // Get volume name/label
          CFStringRef volumeName = (CFStringRef)CFDictionaryGetValue(
              description, kDADiskDescriptionVolumeNameKey);
          if (volumeName) {
            metadata.label = CFStringToString(volumeName);
          }

          // Get UUID
          CFUUIDRef uuid = (CFUUIDRef)CFDictionaryGetValue(
              description, kDADiskDescriptionVolumeUUIDKey);
          if (uuid) {
            CFStringRef uuidString = CFUUIDCreateString(kCFAllocatorDefault, uuid);
            if (uuidString) {
              metadata.uuid = CFStringToString(uuidString);
              CFRelease(uuidString);
            }
          }

          // Check if remote
          CFBooleanRef isNetworkVolume = (CFBooleanRef)CFDictionaryGetValue(
              description, kDADiskDescriptionVolumeNetworkKey);
          if (isNetworkVolume) {
            metadata.remote = CFBooleanGetValue(isNetworkVolume);

            if (metadata.remote) {
              // Get network share information
              CFURLRef url = (CFURLRef)CFDictionaryGetValue(
                  description, kDADiskDescriptionVolumePathKey);
              if (url) {
                CFStringRef urlString = CFURLGetString(url);
                std::string urlStr = CFStringToString(urlString);

                // Parse URL for host and share info
                size_t hostStart = urlStr.find("//") + 2;
                size_t hostEnd = urlStr.find('/', hostStart);
                if (hostStart != std::string::npos && hostEnd != std::string::npos) {
                  metadata.remoteHost = urlStr.substr(hostStart, hostEnd - hostStart);
                  metadata.remoteShare = urlStr.substr(hostEnd + 1);
                }
              }
            }
          }

          CFRelease(description);
        }
        CFRelease(disk);
      }

      CFRelease(session);
    } catch (const std::exception& e) {
      SetError(e.what());
    }
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    Napi::Object result = Napi::Object::New(Env());

    // Set all the metadata properties
    result.Set("mountPoint", mountPoint);
    result.Set("fileSystem", metadata.fileSystem);
    result.Set("size", metadata.size);
    result.Set("used", metadata.used);
    result.Set("available", metadata.available);

    if (!metadata.label.empty()) {
      result.Set("label", metadata.label);
    }
    if (!metadata.uuid.empty()) {
      result.Set("uuid", metadata.uuid);
    }
    if (metadata.remote) {
      result.Set("remote", metadata.remote);
      if (!metadata.remoteHost.empty()) {
        result.Set("remoteHost", metadata.remoteHost);
      }
      if (!metadata.remoteShare.empty()) {
        result.Set("remoteShare", metadata.remoteShare);
      }
    }

    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error& error) override {
    deferred_.Reject(error.Value());
  }

private:
  std::string mountPoint;
  Napi::Promise::Deferred deferred_;
  struct {
    std::string fileSystem;
    std::string label;
    std::string uuid;
    std::string remoteHost;
    std::string remoteShare;
    double size;
    double used;
    double available;
    bool remote = false;
  } metadata;
};


Napi::Value GetVolumeMountPoints(Napi::Env env) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto* worker = new GetVolumeMountPointsWorker(deferred);
  worker->Queue();
  return deferred.Promise();
}

Napi::Value GetVolumeMetadata(Napi::Env env, const std::string& mountPoint) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto* worker = new GetVolumeMetadataWorker(mountPoint, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta