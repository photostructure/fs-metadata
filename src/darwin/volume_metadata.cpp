// src/darwin/volume_metadata.cpp

#include "./fs_meta.h"

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

// Improved CFReleaser with proper Core Foundation support
template <typename T> class CFReleaser {
private:
  T ref_;

public:
  explicit CFReleaser(T ref = nullptr) noexcept : ref_(ref) {}

  // Delete copy operations
  CFReleaser(const CFReleaser &) = delete;
  CFReleaser &operator=(const CFReleaser &) = delete;

  // Move operations
  CFReleaser(CFReleaser &&other) noexcept : ref_(other.ref_) {
    other.ref_ = nullptr;
  }

  CFReleaser &operator=(CFReleaser &&other) noexcept {
    if (this != &other) {
      reset();
      ref_ = other.ref_;
      other.ref_ = nullptr;
    }
    return *this;
  }

  ~CFReleaser() { reset(); }

  void reset(T ref = nullptr) {
    if (ref_) {
      CFRelease(ref_);
    }
    ref_ = ref;
  }

  // Implicit conversion operator for Core Foundation APIs
  operator T() const noexcept { return ref_; }

  T get() const noexcept { return ref_; }
  bool isValid() const noexcept { return ref_ != nullptr; }

  // Release ownership
  T release() noexcept {
    T temp = ref_;
    ref_ = nullptr;
    return temp;
  }
};

class GetVolumeMetadataWorker : public MetadataWorkerBase {
public:
  GetVolumeMetadataWorker(const std::string &mountPoint,
                          const VolumeMetadataOptions &options,
                          const Napi::Promise::Deferred &deferred)
      : MetadataWorkerBase(mountPoint, deferred), options_(options) {}

  void Execute() override {
    try {
      if (!GetBasicVolumeInfo()) {
        return;
      }
      GetDiskArbitrationInfo();
    } catch (const std::exception &e) {
      SetError(e.what());
    }
  }

private:
  VolumeMetadataOptions options_;

  bool GetBasicVolumeInfo() {
    struct statvfs vfs;
    struct statfs fs;

    if (statvfs(mountPoint.c_str(), &vfs) != 0) {
      SetError(CreateErrorMessage("statvfs", errno));
      return false;
    }

    if (statfs(mountPoint.c_str(), &fs) != 0) {
      SetError(CreateErrorMessage("statfs", errno));
      return false;
    }

    // Calculate sizes using uint64_t to prevent overflow
    const uint64_t blockSize = vfs.f_frsize ? vfs.f_frsize : vfs.f_bsize;
    const uint64_t totalBlocks = vfs.f_blocks;
    const uint64_t availBlocks = vfs.f_bavail;
    const uint64_t freeBlocks = vfs.f_bfree;

    // Check for overflow before multiplication
    if (blockSize > 0 &&
        totalBlocks > std::numeric_limits<uint64_t>::max() / blockSize) {
      SetError("Volume size calculation would overflow");
      return false;
    }

    metadata.size = static_cast<double>(blockSize * totalBlocks);
    metadata.available = static_cast<double>(blockSize * availBlocks);
    metadata.used = static_cast<double>(blockSize * (totalBlocks - freeBlocks));

    metadata.fstype = fs.f_fstypename;
    metadata.mountFrom = fs.f_mntfromname;
    metadata.mountName = fs.f_mntonname;
    metadata.status = "ready";

    return true;
  }

  void GetDiskArbitrationInfo() {
    CFReleaser<DASessionRef> session(DASessionCreate(kCFAllocatorDefault));
    if (!session.isValid()) {
      metadata.status = "partial";
      return;
    }

    // Schedule session with RunLoop
    DASessionScheduleWithRunLoop(session.get(), CFRunLoopGetCurrent(),
                                 kCFRunLoopDefaultMode);

    // RAII cleanup for RunLoop scheduling
    struct RunLoopCleaner {
      DASessionRef session;
      explicit RunLoopCleaner(DASessionRef s) : session(s) {}
      ~RunLoopCleaner() {
        DASessionUnscheduleFromRunLoop(session, CFRunLoopGetCurrent(),
                                       kCFRunLoopDefaultMode);
      }
    } runLoopCleaner(session.get());

    CFReleaser<DADiskRef> disk(DADiskCreateFromBSDName(
        kCFAllocatorDefault, session.get(), metadata.mountFrom.c_str()));

    if (!disk.isValid()) {
      metadata.status = "partial";
      return;
    }

    CFReleaser<CFDictionaryRef> description(DADiskCopyDescription(disk.get()));
    if (!description.isValid()) {
      metadata.status = "partial";
      return;
    }

    ProcessDiskDescription(description.get());
  }

  void ProcessDiskDescription(CFDictionaryRef description) {
    // Get volume name/label
    if (CFStringRef volumeName = (CFStringRef)CFDictionaryGetValue(
            description, kDADiskDescriptionVolumeNameKey)) {
      metadata.label = CFStringToString(volumeName);
    }

    // Get UUID
    if (CFUUIDRef uuid = (CFUUIDRef)CFDictionaryGetValue(
            description, kDADiskDescriptionVolumeUUIDKey)) {
      CFReleaser<CFStringRef> uuidString(
          CFUUIDCreateString(kCFAllocatorDefault, uuid));
      if (uuidString.isValid()) {
        metadata.uuid = CFStringToString(uuidString.get());
      }
    }

    ProcessNetworkVolume(description);
  }

  void ProcessNetworkVolume(CFDictionaryRef description) {
    CFBooleanRef isNetworkVolume = (CFBooleanRef)CFDictionaryGetValue(
        description, kDADiskDescriptionVolumeNetworkKey);

    metadata.remote = CFBooleanGetValue(isNetworkVolume);
    CFURLRef url = (CFURLRef)CFDictionaryGetValue(
        description, kDADiskDescriptionVolumePathKey);
    if (!url) {
      return;
    }

    CFStringRef urlString = CFURLGetString(url);
    if (!urlString) {
      return;
    }
    metadata.uri = CFStringToString(urlString);
  }
};

Napi::Value GetVolumeMetadata(const Napi::CallbackInfo &info) {
  auto env = info.Env();

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