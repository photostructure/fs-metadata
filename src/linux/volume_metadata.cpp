// src/linux/volume_metadata.cpp
#include "../common/volume_metadata.h"
#include "../common/debug_log.h"
#include "../common/error_utils.h"
#include "../common/fd_guard.h"
#include "../common/metadata_worker.h"
#include "../common/path_security.h"
#include "../common/volume_utils.h"
#include "blkid_cache.h"
#include <cstdio>  // for snprintf()
#include <cstdlib> // for free()
#include <cstring> // for memset(), strerror()
#include <fcntl.h> // for open(), O_DIRECTORY, O_RDONLY, O_CLOEXEC
#include <memory>
#include <sys/statvfs.h>
#include <unistd.h>

// btrfs subvolume-UUID support is optional. The UAPI header <linux/btrfs.h> is
// present on glibc distros (linux-libc-dev) and on Alpine when the
// linux-headers package is installed, but may be absent in minimal
// build-from-source environments. Guard on __has_include so the module still
// compiles where it is missing (the feature is simply unavailable, and
// subvolumeUuid stays undefined).
#if defined(__has_include)
#if __has_include(<linux/btrfs.h>)
#include <linux/btrfs.h> // BTRFS_IOC_GET_SUBVOL_INFO, btrfs_ioctl_get_subvol_info_args
#include <sys/ioctl.h> // ioctl()
#define FSMETA_HAVE_BTRFS 1
#endif
#endif

namespace FSMeta {

class LinuxMetadataWorker : public MetadataWorkerBase {
public:
  LinuxMetadataWorker(const std::string &mountPoint,
                      const VolumeMetadataOptions &options,
                      const Napi::Promise::Deferred &deferred)
      : MetadataWorkerBase(mountPoint, deferred), options_(options) {}

  void Execute() override {
    if (IsShuttingDown()) {
      SetError("fs-metadata: shutdown in progress");
      return;
    }
    try {
      DEBUG_LOG("[LinuxMetadataWorker] starting statvfs for %s",
                mountPoint.c_str());

      // Validate and canonicalize mount point using realpath()
      // This prevents directory traversal attacks and resolves symlinks
      std::string error;
      std::string validated_mount_point =
          ValidatePathForRead(mountPoint, error);
      if (validated_mount_point.empty()) {
        throw FSException(error);
      }

      DEBUG_LOG("[LinuxMetadataWorker] Using validated mount point: %s",
                validated_mount_point.c_str());

      // SECURITY: Use file descriptor-based approach to prevent TOCTOU race
      // condition
      //
      // Time-of-check-time-of-use (TOCTOU) vulnerability:
      // The mount point could be unmounted or replaced between the statvfs call
      // and subsequent operations. Using a file descriptor prevents this.
      //
      // See: Finding #9 in SECURITY_AUDIT_2025.md
      // Reference: https://man7.org/linux/man-pages/man2/open.2.html
      //
      // O_DIRECTORY: Ensures we're opening a directory, fails if not
      // O_RDONLY: Read-only access (sufficient for fstatvfs)
      // O_CLOEXEC: Close on exec (prevents fd leaks in multithreaded programs)
      int fd = open(validated_mount_point.c_str(),
                    O_DIRECTORY | O_RDONLY | O_CLOEXEC);
      if (fd < 0) {
        int error = errno;
        DEBUG_LOG("[LinuxMetadataWorker] open failed for %s: %s (%d)",
                  validated_mount_point.c_str(), strerror(error), error);
        throw FSException(
            CreatePathErrorMessage("open", validated_mount_point, error));
      }

      // RAII guard to ensure file descriptor is always closed
      FdGuard fd_guard(fd);

      // Use fstatvfs on the file descriptor instead of statvfs on the path
      // The fd holds a reference to the filesystem, preventing TOCTOU issues
      struct statvfs vfs;
      if (fstatvfs(fd, &vfs) != 0) {
        int error = errno;
        DEBUG_LOG("[LinuxMetadataWorker] fstatvfs failed for %s: %s (%d)",
                  validated_mount_point.c_str(), strerror(error), error);
        throw FSException(
            CreatePathErrorMessage("fstatvfs", validated_mount_point, error));
      }

      // fd_guard will automatically close the file descriptor when this
      // function returns (whether by normal return or exception)

      const uint64_t blockSize = vfs.f_frsize ? vfs.f_frsize : vfs.f_bsize;
      const uint64_t totalBlocks = static_cast<uint64_t>(vfs.f_blocks);
      const uint64_t availBlocks = static_cast<uint64_t>(vfs.f_bavail);
      const uint64_t freeBlocks = static_cast<uint64_t>(vfs.f_bfree);

      // Check for overflow before multiplication
      if (WouldOverflow(blockSize, totalBlocks)) {
        throw FSException("Total volume size calculation would overflow");
      }
      if (WouldOverflow(blockSize, availBlocks)) {
        throw FSException("Available space calculation would overflow");
      }
      if (WouldOverflow(blockSize, freeBlocks)) {
        throw FSException("Free space calculation would overflow");
      }

      metadata.remote = false;
      metadata.size = static_cast<double>(blockSize * totalBlocks);
      metadata.available = static_cast<double>(blockSize * availBlocks);
      metadata.used =
          static_cast<double>(blockSize * (totalBlocks - freeBlocks));

      DEBUG_LOG("[LinuxMetadataWorker] %s {size: %.3f GB, available: %.3f GB}",
                mountPoint.c_str(), metadata.size / 1e9,
                metadata.available / 1e9);

      if (!options_.device.empty()) {
        DEBUG_LOG("[LinuxMetadataWorker] getting blkid info for device %s",
                  options_.device.c_str());
        try {
          BlkidCache cache;

          // blkid_get_tag_value() returns a strdup()'d C string (libblkid is
          // a C library), so it must be released with free(), not delete.
          // Wrap it immediately so the free() also happens if the
          // std::string assignment throws.
          // See: Finding #10 in SECURITY_AUDIT_2025.md
          std::unique_ptr<char, decltype(&free)> uuid(
              blkid_get_tag_value(cache.get(), "UUID", options_.device.c_str()),
              &free);
          if (uuid) {
            metadata.uuid = uuid.get();
            DEBUG_LOG("[LinuxMetadataWorker] found UUID for %s: %s",
                      options_.device.c_str(), metadata.uuid.c_str());
          }

          std::unique_ptr<char, decltype(&free)> label(
              blkid_get_tag_value(cache.get(), "LABEL",
                                  options_.device.c_str()),
              &free);
          if (label) {
            metadata.label = label.get();
            DEBUG_LOG("[LinuxMetadataWorker] found label for %s: %s",
                      options_.device.c_str(), metadata.label.c_str());
          }
        } catch (const std::exception &e) {
          DEBUG_LOG("[LinuxMetadataWorker] blkid error for %s: %s",
                    options_.device.c_str(), e.what());
          metadata.status = std::string("Blkid warning: ") + e.what();
        }
      }

#ifdef FSMETA_HAVE_BTRFS
      // btrfs: distinct subvolumes of one filesystem share a single libblkid fs
      // UUID (blkid keys on the block device). BTRFS_IOC_GET_SUBVOL_INFO reads
      // the per-subvolume UUID from the subvolume's root item — stable across
      // remount/reboot, preserved by `btrfs send`/`receive` as received_uuid,
      // and freshly minted (with parent_uuid) for snapshots. It is unprivileged
      // (kernel >= 4.18). We reuse the mount-point fd already opened above.
      //
      // Gated on fstype so we never issue a btrfs ioctl against another
      // filesystem (in particular, never against network mounts).
      if (options_.fstype == "btrfs") {
        struct btrfs_ioctl_get_subvol_info_args subvol_info;
        memset(&subvol_info, 0, sizeof(subvol_info));
        // NOTE: on success this ioctl returns a POSITIVE value (observed: 1),
        // not 0 — so only a negative return indicates failure. Unsupported
        // kernels or a non-subvolume path yield ENOTTY/EINVAL/EPERM, in which
        // case we degrade silently and leave subvolumeUuid unset.
        if (ioctl(fd, BTRFS_IOC_GET_SUBVOL_INFO, &subvol_info) >= 0) {
          const unsigned char *u = subvol_info.uuid;
          char uuid_str[37]; // 36 chars + NUL
          snprintf(
              uuid_str, sizeof(uuid_str),
              "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x"
              "%02x%02x",
              u[0], u[1], u[2], u[3], u[4], u[5], u[6], u[7], u[8], u[9], u[10],
              u[11], u[12], u[13], u[14], u[15]);
          metadata.subvolumeUuid = uuid_str;
          DEBUG_LOG("[LinuxMetadataWorker] btrfs subvolume '%s' (id %llu) "
                    "uuid %s",
                    subvol_info.name,
                    static_cast<unsigned long long>(subvol_info.treeid),
                    metadata.subvolumeUuid.c_str());
        } else {
          DEBUG_LOG("[LinuxMetadataWorker] BTRFS_IOC_GET_SUBVOL_INFO "
                    "unavailable for %s: %s",
                    validated_mount_point.c_str(), strerror(errno));
        }
      }
#endif
    } catch (const std::exception &e) {
      DEBUG_LOG("[LinuxMetadataWorker] error: %s", e.what());
      SetError(e.what());
    }
  }

private:
  VolumeMetadataOptions options_;
};

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
  auto *worker = new LinuxMetadataWorker(options.mountPoint, options, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta
