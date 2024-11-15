// src/darwin/fs_meta.cpp

#include "fs_meta.h"

#include <CoreFoundation/CoreFoundation.h>
#include <DiskArbitration/DiskArbitration.h>
#include <IOKit/IOBSD.h>
#include <IOKit/storage/IOMedia.h>
#include <IOKit/storage/IOStorageProtocolCharacteristics.h>
#include <memory>
#include <string>
#include <sys/mount.h>
#include <sys/param.h>
#include <sys/statvfs.h>
#include <vector>

namespace FSMeta {

// Helper function to convert CFString to std::string
static std::string CFStringToString(CFStringRef cfString) {
  if (!cfString) {
    return "";
  }

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

// Helper to safely release CF objects
template <typename T> class CFReleaser {
  T ref_;

public:
  explicit CFReleaser(T ref) : ref_(ref) {}
  ~CFReleaser() {
    if (ref_)
      CFRelease(ref_);
  }
  operator T() const { return ref_; }
  T get() const { return ref_; }
};

class GetVolumeMountPointsWorker : public Napi::AsyncWorker {
public:
  GetVolumeMountPointsWorker(const Napi::Promise::Deferred &deferred)
      : Napi::AsyncWorker(deferred.Env()), deferred_(deferred) {}

  void Execute() override {
    try {
      struct statfs *mntbufp;
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
    } catch (const std::exception &e) {
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

  void OnError(const Napi::Error &error) override {
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
  GetVolumeMetadataWorker(const std::string &path,
                          const Napi::Promise::Deferred &deferred)
      : Napi::AsyncWorker(deferred.Env()), mountPoint(path),
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

      // Calculate sizes using uint64_t to prevent overflow
      uint64_t blockSize = vfs.f_frsize ? vfs.f_frsize : vfs.f_bsize;

      // Calculate total size first
      metadata.size =
          static_cast<double>(blockSize) * static_cast<double>(vfs.f_blocks);

      // Calculate available space
      metadata.available =
          static_cast<double>(blockSize) * static_cast<double>(vfs.f_bavail);

      // Calculate used space as the difference between total and free
      double totalFree =
          static_cast<double>(blockSize) * static_cast<double>(vfs.f_bfree);
      metadata.used = metadata.size - totalFree;

      // Sanity check to ensure used + available <= size
      if (metadata.used + metadata.available > metadata.size) {
        metadata.used = metadata.size - metadata.available;
      }

      // Store filesystem type
      metadata.fileSystem = fs.f_fstypename;

      // Get additional information using DiskArbitration framework
      CFReleaser<DASessionRef> session(DASessionCreate(kCFAllocatorDefault));
      if (!session.get()) {
        throw std::runtime_error("Failed to create DiskArbitration session");
      }

      CFReleaser<DADiskRef> disk(DADiskCreateFromBSDName(
          kCFAllocatorDefault, session, fs.f_mntfromname));

      if (disk.get()) {
        CFReleaser<CFDictionaryRef> description(DADiskCopyDescription(disk));
        if (description.get()) {
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
            CFReleaser<CFStringRef> uuidString(
                CFUUIDCreateString(kCFAllocatorDefault, uuid));
            if (uuidString.get()) {
              metadata.uuid = CFStringToString(uuidString);
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
                if (hostStart != std::string::npos &&
                    hostEnd != std::string::npos) {
                  metadata.remoteHost =
                      urlStr.substr(hostStart, hostEnd - hostStart);
                  metadata.remoteShare = urlStr.substr(hostEnd + 1);
                }
              }
            }
          }
        }
      }
    } catch (const std::exception &e) {
      SetError(e.what());
    }
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());

    Napi::Object result = Napi::Object::New(Env());
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

  void OnError(const Napi::Error &error) override {
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