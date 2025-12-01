// src/linux/volume_metadata.cpp
#include "../common/volume_metadata.h"
#include "../common/debug_log.h"
#include "../common/error_utils.h"
#include "../common/fd_guard.h"
#include "../common/metadata_worker.h"
#include "../common/volume_utils.h"
#include "blkid_cache.h"
#include <fcntl.h> // for open(), O_DIRECTORY, O_RDONLY, O_CLOEXEC
#include <memory>
#include <sys/statvfs.h>
#include <unistd.h>

#ifdef ENABLE_GIO
#include "gio_volume_metadata.h"
#endif

namespace FSMeta {

class LinuxMetadataWorker : public MetadataWorkerBase {
public:
  LinuxMetadataWorker(const std::string &mountPoint,
                      const VolumeMetadataOptions &options,
                      const Napi::Promise::Deferred &deferred)
      : MetadataWorkerBase(mountPoint, deferred), options_(options) {
    // Validate mount point is not empty
    if (mountPoint.empty()) {
      throw std::invalid_argument("Mount point cannot be empty");
    }
  }

  void Execute() override {
    try {
      DEBUG_LOG("[LinuxMetadataWorker] starting statvfs for %s",
                mountPoint.c_str());

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
      int fd = open(mountPoint.c_str(), O_DIRECTORY | O_RDONLY | O_CLOEXEC);
      if (fd < 0) {
        int error = errno;
        DEBUG_LOG("[LinuxMetadataWorker] open failed for %s: %s (%d)",
                  mountPoint.c_str(), strerror(error), error);
        throw FSException(CreatePathErrorMessage("open", mountPoint, error));
      }

      // RAII guard to ensure file descriptor is always closed
      FdGuard fd_guard(fd);

      // Use fstatvfs on the file descriptor instead of statvfs on the path
      // The fd holds a reference to the filesystem, preventing TOCTOU issues
      struct statvfs vfs;
      if (fstatvfs(fd, &vfs) != 0) {
        int error = errno;
        DEBUG_LOG("[LinuxMetadataWorker] fstatvfs failed for %s: %s (%d)",
                  mountPoint.c_str(), strerror(error), error);
        throw FSException(
            CreatePathErrorMessage("fstatvfs", mountPoint, error));
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

#ifdef ENABLE_GIO
      try {
        DEBUG_LOG("[LinuxMetadataWorker] collecting GIO metadata for %s",
                  mountPoint.c_str());
        gio::addMountMetadata(mountPoint, metadata);
      } catch (const std::exception &e) {
        DEBUG_LOG("[LinuxMetadataWorker] GIO error for %s: %s",
                  mountPoint.c_str(), e.what());
        metadata.status = std::string("GIO warning: ") + e.what();
      }
#endif

      if (!options_.device.empty()) {
        DEBUG_LOG("[LinuxMetadataWorker] getting blkid info for device %s",
                  options_.device.c_str());
        try {
          BlkidCache cache;

          // MEMORY MANAGEMENT: blkid_get_tag_value() returns strings allocated
          // with strdup()
          //
          // CRITICAL: These strings MUST be freed with free(), NOT delete or
          // delete[] blkid is a C library (libblkid), and blkid_get_tag_value()
          // uses strdup() internally which allocates memory with malloc().
          //
          // Memory allocated with malloc() must be deallocated with free().
          // Using delete or delete[] would invoke the wrong deallocator and
          // cause undefined behavior (likely a crash).
          //
          // See: Finding #10 in SECURITY_AUDIT_2025.md
          // Reference:
          // https://github.com/util-linux/util-linux/blob/master/libblkid/src/resolve.c
          // The blkid_get_tag_value() implementation shows it uses strdup():
          //   return res ? strdup(res) : NULL;

          char *uuid =
              blkid_get_tag_value(cache.get(), "UUID", options_.device.c_str());
          if (uuid) {
            metadata.uuid = uuid;
            free(uuid); // IMPORTANT: Use free(), not delete (C API, uses
                        // malloc/strdup)
            DEBUG_LOG("[LinuxMetadataWorker] found UUID for %s: %s",
                      options_.device.c_str(), metadata.uuid.c_str());
          }

          char *label = blkid_get_tag_value(cache.get(), "LABEL",
                                            options_.device.c_str());
          if (label) {
            metadata.label = label;
            free(label); // IMPORTANT: Use free(), not delete (C API, uses
                         // malloc/strdup)
            DEBUG_LOG("[LinuxMetadataWorker] found label for %s: %s",
                      options_.device.c_str(), metadata.label.c_str());
          }
        } catch (const std::exception &e) {
          DEBUG_LOG("[LinuxMetadataWorker] blkid error for %s: %s",
                    options_.device.c_str(), e.what());
          metadata.status = std::string("Blkid warning: ") + e.what();
        }
      }
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

  VolumeMetadataOptions options;
  if (info.Length() > 0 && info[0].IsObject()) {
    options = VolumeMetadataOptions::FromObject(info[0].As<Napi::Object>());
  }

  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new LinuxMetadataWorker(options.mountPoint, options, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta