// src/darwin/volume_metadata.cpp
// Thread-safe implementation with DiskArbitration mutex synchronization

#include "../common/debug_log.h"
#include "./fs_meta.h"
#include "./path_security.h"
#include "./raii_utils.h"

#include <CoreFoundation/CoreFoundation.h>
#include <DiskArbitration/DiskArbitration.h>
#include <fcntl.h> // For open(), O_RDONLY, O_DIRECTORY
#include <memory>
#include <mutex>
#include <string>
#include <sys/mount.h>
#include <sys/param.h>
#include <sys/statvfs.h>
#include <unistd.h> // For close()

namespace FSMeta {

// Global mutex for DiskArbitration operations
static std::mutex g_diskArbitrationMutex;

// Helper function to convert CFString to std::string
static std::string CFStringToString(CFStringRef cfString) {
  if (!cfString) {
    return "";
  }

  CFIndex length = CFStringGetLength(cfString);
  if (length == 0) {
    return "";
  }

  // Check for overflow when calculating buffer size
  CFIndex maxSize =
      CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8);
  if (maxSize == kCFNotFound || maxSize > INT_MAX - 1) {
    return "";
  }
  maxSize += 1; // For null terminator

  std::string result(maxSize, '\0');

  Boolean success =
      CFStringGetCString(cfString, &result[0], maxSize, kCFStringEncodingUTF8);
  if (!success) {
    // Log the failure for debugging
    // Common reasons: encoding issue, buffer too small, or malformed string
    DEBUG_LOG("[CFStringToString] Conversion failed - likely encoding issue or "
              "buffer too small");
    DEBUG_LOG("[CFStringToString] maxSize: %ld, string length: %ld", maxSize,
              CFStringGetLength(cfString));
    return "";
  }

  // Find actual string length by looking for null terminator
  // This is safer than using strlen which could read past buffer
  size_t actualLength = 0;
  for (size_t i = 0; i < static_cast<size_t>(maxSize); ++i) {
    if (result[i] == '\0') {
      actualLength = i;
      break;
    }
  }

  result.resize(actualLength);
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
      // Validate and canonicalize mount point using realpath()
      // This follows Apple's Secure Coding Guide recommendations
      std::string error;
      std::string validated_mount_point =
          ValidatePathForRead(mountPoint, error);
      if (validated_mount_point.empty()) {
        SetError(error);
        return;
      }

      // Use validated path for all subsequent operations
      DEBUG_LOG("[GetVolumeMetadataWorker] Using validated mount point: %s",
                validated_mount_point.c_str());

      // Temporarily store original mountPoint and replace with validated one
      std::string original_mount_point = mountPoint;
      mountPoint = validated_mount_point;

      if (!GetBasicVolumeInfo()) {
        mountPoint = original_mount_point; // Restore for error reporting
        return;
      }
      GetDiskArbitrationInfoSafe();

      // Restore original for consistency
      mountPoint = original_mount_point;
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

    // Use file descriptors to prevent TOCTOU race conditions
    // Open the mount point directory with O_DIRECTORY to ensure it's a
    // directory
    int fd = open(mountPoint.c_str(), O_RDONLY | O_DIRECTORY);
    if (fd < 0) {
      int error = errno;
      DEBUG_LOG("[GetVolumeMetadataWorker] open failed: %s (%d)",
                strerror(error), error);
      SetError(CreatePathErrorMessage("open", mountPoint, error));
      return false;
    }

    // RAII wrapper for file descriptor to ensure it's always closed
    struct FdGuard {
      int fd;
      ~FdGuard() {
        if (fd >= 0) {
          close(fd);
        }
      }
    } fd_guard{fd};

    struct statvfs vfs;
    struct statfs fs;

    // Use fstatvfs and fstatfs on the file descriptor to prevent TOCTOU
    // The fd holds a reference to the filesystem, preventing mount changes
    if (fstatvfs(fd, &vfs) != 0) {
      int error = errno;
      DEBUG_LOG("[GetVolumeMetadataWorker] fstatvfs failed: %s (%d)",
                strerror(error), error);
      SetError(CreatePathErrorMessage("fstatvfs", mountPoint, error));
      return false;
    }

    if (fstatfs(fd, &fs) != 0) {
      int error = errno;
      DEBUG_LOG("[GetVolumeMetadataWorker] fstatfs failed: %s (%d)",
                strerror(error), error);
      SetError(CreatePathErrorMessage("fstatfs", mountPoint, error));
      return false;
    }

    // fd_guard will automatically close the file descriptor when this function
    // returns

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

  void GetDiskArbitrationInfoSafe() {
    DEBUG_LOG("[GetVolumeMetadataWorker] Getting Disk Arbitration info for: %s",
              mountPoint.c_str());

    // Check if this is a network filesystem
    if (metadata.fstype == "smbfs" || metadata.fstype == "nfs" ||
        metadata.fstype == "afpfs" || metadata.fstype == "webdav") {
      metadata.remote = true;
      metadata.status = "healthy";
      return;
    }

    // Use a global mutex to serialize DiskArbitration access
    std::lock_guard<std::mutex> lock(g_diskArbitrationMutex);

    // Create session without scheduling on run loop
    CFReleaser<DASessionRef> session(DASessionCreate(kCFAllocatorDefault));
    if (!session.isValid()) {
      DEBUG_LOG("[GetVolumeMetadataWorker] Failed to create DA session");
      metadata.status = "partial";
      metadata.error = "Failed to create DA session";
      return;
    }

    try {
      CFReleaser<DADiskRef> disk(DADiskCreateFromBSDName(
          kCFAllocatorDefault, session.get(), metadata.mountFrom.c_str()));

      if (!disk.isValid()) {
        DEBUG_LOG("[GetVolumeMetadataWorker] Failed to create disk reference");
        metadata.status = "partial";
        metadata.error = "Failed to create disk reference";
        return;
      }

      // Get disk description without scheduling on run loop
      CFReleaser<CFDictionaryRef> description(
          DADiskCopyDescription(disk.get()));
      if (!description.isValid()) {
        DEBUG_LOG("[GetVolumeMetadataWorker] Failed to get disk description");
        metadata.status = "partial";
        metadata.error = "Failed to get disk description";
        return;
      }

      // Process description immediately
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
    if (isNetworkVolume) {
      metadata.remote = CFBooleanGetValue(isNetworkVolume);
    }

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