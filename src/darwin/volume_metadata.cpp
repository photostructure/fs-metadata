// src/darwin/volume_metadata.cpp

#include "../common/debug_log.h"
#include "./fs_meta.h"
#include "./raii_utils.h"

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

class GetVolumeMetadataWorker : public MetadataWorkerBase {
public:
  GetVolumeMetadataWorker(const std::string &mountPoint,
                          const VolumeMetadataOptions &options,
                          const Napi::Promise::Deferred &deferred)
      : MetadataWorkerBase(mountPoint, deferred), options_(options) {}

  void Execute() override {
    DEBUG_LOG("[GetVolumeMetadataWorker] Executing for mount point: %s",
              mountPoint.c_str());
    try {
      if (!GetBasicVolumeInfo()) {
        return;
      }
      GetDiskArbitrationInfo();
    } catch (const std::exception &e) {
      DEBUG_LOG("[GetVolumeMetadataWorker] Exception: %s", e.what());
      SetError(e.what());
    }
  }

private:
  VolumeMetadataOptions options_;

  bool GetBasicVolumeInfo() {
    DEBUG_LOG("[GetVolumeMetadataWorker] Getting basic volume info for: %s",
              mountPoint.c_str());
    struct statvfs vfs;
    struct statfs fs;

    if (statvfs(mountPoint.c_str(), &vfs) != 0) {
      DEBUG_LOG("[GetVolumeMetadataWorker] statvfs failed: %s (%d)",
                strerror(errno), errno);
      SetError(CreateErrorMessage("statvfs", errno));
      return false;
    }

    if (statfs(mountPoint.c_str(), &fs) != 0) {
      DEBUG_LOG("[GetVolumeMetadataWorker] statfs failed: %s (%d)",
                strerror(errno), errno);
      SetError(CreateErrorMessage("statfs", errno));
      return false;
    }

    // Calculate sizes using uint64_t to prevent overflow
    const uint64_t blockSize = vfs.f_frsize ? vfs.f_frsize : vfs.f_bsize;
    const uint64_t totalBlocks = static_cast<uint64_t>(vfs.f_blocks);
    const uint64_t availBlocks = static_cast<uint64_t>(vfs.f_bavail);
    const uint64_t freeBlocks = static_cast<uint64_t>(vfs.f_bfree);

    // Check for overflow before multiplication
    if (blockSize > 0) {
      if (totalBlocks > std::numeric_limits<uint64_t>::max() / blockSize) {
        SetError("Total volume size calculation would overflow");
        return false;
      }
      if (availBlocks > std::numeric_limits<uint64_t>::max() / blockSize) {
        SetError("Available space calculation would overflow");
        return false;
      }
      if (freeBlocks > std::numeric_limits<uint64_t>::max() / blockSize) {
        SetError("Free space calculation would overflow");
        return false;
      }
    }

    const uint64_t totalSize = blockSize * totalBlocks;
    const uint64_t availableSize = blockSize * availBlocks;
    const uint64_t usedSize = blockSize * (totalBlocks - freeBlocks);

    // Convert to double for JavaScript compatibility
    metadata.size = static_cast<double>(totalSize);
    metadata.available = static_cast<double>(availableSize);
    metadata.used = static_cast<double>(usedSize);

    metadata.fstype = fs.f_fstypename;
    metadata.mountFrom = fs.f_mntfromname;
    metadata.mountName = fs.f_mntonname;
    metadata.status = "ready";

    DEBUG_LOG("[GetVolumeMetadataWorker] Volume info - size: %.0f, available: "
              "%.0f, used: %.0f",
              metadata.size, metadata.available, metadata.used);
    return true;
  }

  void GetDiskArbitrationInfo() {
    DEBUG_LOG("[GetVolumeMetadataWorker] Getting Disk Arbitration info for: %s",
              mountPoint.c_str());

    // Check if this is a network filesystem
    if (metadata.fstype == "smbfs" || metadata.fstype == "nfs" ||
        metadata.fstype == "afpfs" || metadata.fstype == "webdav") {
      metadata.remote = true;
      metadata.status = "healthy";
      return;
    }

    // Create session on current thread
    CFReleaser<DASessionRef> session(DASessionCreate(kCFAllocatorDefault));
    if (!session.isValid()) {
      DEBUG_LOG("[GetVolumeMetadataWorker] Failed to create DA session");
      metadata.status = "partial";
      metadata.error = "Failed to create DA session";
      return;
    }

    try {
      // Get thread-local runloop or create new one if needed
      CFRunLoopRef runLoop = CFRunLoopGetCurrent();
      if (!runLoop) {
        // If no runloop exists, create a new one for this thread
        CFRunLoopRun();
        runLoop = CFRunLoopGetCurrent();
        if (!runLoop) {
          throw std::runtime_error("Failed to create thread-local runloop");
        }
      }

      // Schedule session with our runloop
      DASessionScheduleWithRunLoop(session.get(), runLoop,
                                   kCFRunLoopDefaultMode);

      // Use RAII to ensure cleanup
      struct RunLoopCleaner {
        DASessionRef session;
        CFRunLoopRef runLoop;
        bool shouldStop;
        RunLoopCleaner(DASessionRef s, CFRunLoopRef l, bool stop = false)
            : session(s), runLoop(l), shouldStop(stop) {}
        ~RunLoopCleaner() {
          DASessionUnscheduleFromRunLoop(session, runLoop,
                                         kCFRunLoopDefaultMode);
          if (shouldStop) {
            CFRunLoopStop(runLoop);
          }
        }
      } scopeGuard(session.get(), runLoop, !CFRunLoopGetCurrent());

      // Run the run loop briefly to ensure DA is ready
      CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, true);

      CFReleaser<DADiskRef> disk(DADiskCreateFromBSDName(
          kCFAllocatorDefault, session.get(), metadata.mountFrom.c_str()));

      if (!disk.isValid()) {
        DEBUG_LOG("[GetVolumeMetadataWorker] Failed to create disk reference");
        metadata.status = "partial";
        metadata.error = "Failed to create disk reference";
        return;
      }

      CFReleaser<CFDictionaryRef> description(
          DADiskCopyDescription(disk.get()));
      if (!description.isValid()) {
        DEBUG_LOG("[GetVolumeMetadataWorker] Failed to get disk description");
        metadata.status = "partial";
        metadata.error = "Failed to get disk description";
        return;
      }

      // Ensure we have a complete description before continuing
      CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);

      // Process description synchronously since we're already on the right
      // thread
      ProcessDiskDescription(description.get());

      if (metadata.status != "partial") {
        metadata.status = "healthy";
      }

    } catch (const std::exception &e) {
      DEBUG_LOG("[GetVolumeMetadataWorker] Exception: %s", e.what());
      metadata.status = "error";
      metadata.error = e.what();
    }
  }

  void ProcessDiskDescription(CFDictionaryRef description) {
    DEBUG_LOG("[GetVolumeMetadataWorker] Processing disk description");
    if (!description) {
      DEBUG_LOG("[GetVolumeMetadataWorker] Invalid disk description");
      metadata.status = "partial";
      metadata.error = "Invalid disk description";
      return;
    }

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
    DEBUG_LOG("[GetVolumeMetadataWorker] Processing network volume");
    CFBooleanRef isNetworkVolume = (CFBooleanRef)CFDictionaryGetValue(
        description, kDADiskDescriptionVolumeNetworkKey);
    metadata.remote = CFBooleanGetValue(isNetworkVolume);

    CFURLRef url = (CFURLRef)CFDictionaryGetValue(
        description, kDADiskDescriptionVolumePathKey);
    if (!url) {
      metadata.error = "Invalid URL";
      return;
    }
    CFReleaser<CFStringRef> urlString(
        CFURLCopyFileSystemPath(url, kCFURLPOSIXPathStyle));
    if (!urlString.isValid()) {
      metadata.error = std::string("Invalid URL string: ") +
                       CFStringToString(urlString.get());
      return;
    }

    DEBUG_LOG("[GetVolumeMetadataWorker] URL path: %s",
              CFStringToString(urlString.get()).c_str());
    metadata.uri = CFStringToString(urlString.get());
  }
};

Napi::Value GetVolumeMetadata(const Napi::CallbackInfo &info) {
  auto env = info.Env();
  DEBUG_LOG("[GetVolumeMetadata] called");

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