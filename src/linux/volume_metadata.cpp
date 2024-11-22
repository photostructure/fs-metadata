// src/linux/volume_metadata.cpp
#include "../common/volume_metadata.h"
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
  LinuxMetadataWorker(const std::string &path,
                      const VolumeMetadataOptions &options,
                      const Napi::Promise::Deferred &deferred)
      : MetadataWorkerBase(path, deferred), options_(options) {}

  void Execute() override {
    try {
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

#ifdef ENABLE_GIO
      try {
        gio::addMountMetadata(mountPoint, metadata);
      } catch (const std::exception &e) {
        metadata.status = std::string("GIO warning: ") + e.what();
      }
#endif

      if (!options_.device.empty()) {
        try {
          BlkidCache cache;
          char *uuid =
              blkid_get_tag_value(cache.get(), "UUID", options_.device.c_str());
          if (uuid) {
            metadata.uuid = uuid;
            free(uuid);
          }

          char *label = blkid_get_tag_value(cache.get(), "LABEL",
                                            options_.device.c_str());
          if (label) {
            metadata.label = label;
            free(label);
          }
        } catch (const std::exception &e) {
          metadata.status = std::string("Blkid warning: ") + e.what();
        }
      }
    } catch (const std::exception &e) {
      SetError(e.what());
    }
  }

private:
  VolumeMetadataOptions options_;
};

Napi::Value GetVolumeMetadata(const Napi::Env &env,
                              const std::string &mountPoint,
                              const Napi::Object &options) {
  auto deferred = Napi::Promise::Deferred::New(env);

  VolumeMetadataOptions opts;
  opts.timeoutMs =
      options.Has("timeoutMs")
          ? options.Get("timeoutMs").As<Napi::Number>().Uint32Value()
          : 5000;
  opts.device = options.Has("device")
                    ? options.Get("device").As<Napi::String>().Utf8Value()
                    : "";

  auto *worker = new LinuxMetadataWorker(mountPoint, opts, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta