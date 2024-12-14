// src/linux/volume_metadata.cpp
#include "../common/volume_metadata.h"
#include "../common/debug_log.h"
#include "../common/error_utils.h"
#include "../common/metadata_worker.h"
#include "blkid_cache.h"
#include <memory>
#include <sys/statvfs.h>

#ifdef ENABLE_GIO
#include "gio_utils.h"
#endif

namespace FSMeta {

class LinuxMetadataWorker : public MetadataWorkerBase {
public:
  LinuxMetadataWorker(const std::string &mountPoint,
                      const VolumeMetadataOptions &options,
                      const Napi::Promise::Deferred &deferred)
      : MetadataWorkerBase(mountPoint, deferred), options_(options) {}

  void Execute() override {
    try {
      DEBUG_LOG("[LinuxMetadataWorker] starting statvfs for %s",
                mountPoint.c_str());
      struct statvfs vfs;
      if (statvfs(mountPoint.c_str(), &vfs) != 0) {
        throw FSException(CreateErrorMessage("statvfs", errno));
      }

      uint64_t blockSize = vfs.f_frsize ? vfs.f_frsize : vfs.f_bsize;
      metadata.remote = false;
      metadata.size = static_cast<double>(blockSize) * vfs.f_blocks;
      metadata.available = static_cast<double>(blockSize) * vfs.f_bavail;
      metadata.used =
          metadata.size - (static_cast<double>(blockSize) * vfs.f_bfree);

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
          char *uuid =
              blkid_get_tag_value(cache.get(), "UUID", options_.device.c_str());
          if (uuid) {
            metadata.uuid = uuid;
            free(uuid);
            DEBUG_LOG("[LinuxMetadataWorker] found UUID for %s: %s",
                      options_.device.c_str(), metadata.uuid.c_str());
          }

          char *label = blkid_get_tag_value(cache.get(), "LABEL",
                                            options_.device.c_str());
          if (label) {
            metadata.label = label;
            free(label);
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