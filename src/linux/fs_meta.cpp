// src/linux/fs_meta.cpp
#include "fs_meta.h"
#include <memory>
#include <stdexcept>
#include <string>
#include <sys/statvfs.h>

#include "blkid_cache.h"

#ifdef ENABLE_GIO
#include "gio_utils.h"
#endif

namespace FSMeta {

void GetVolumeMetadataWorker::Execute() {
  try {
    struct statvfs vfs;
    if (statvfs(mountPoint.c_str(), &vfs) != 0) {
      throw std::runtime_error("Failed to get volume statistics");
    }

    // Basic stats are always available
    uint64_t blockSize = vfs.f_frsize ? vfs.f_frsize : vfs.f_bsize;
    metadata.size = static_cast<double>(blockSize) * vfs.f_blocks;
    metadata.available = static_cast<double>(blockSize) * vfs.f_bavail;
    metadata.used =
        metadata.size - (static_cast<double>(blockSize) * vfs.f_bfree);
    metadata.ok = true;

// Optional GIO metadata if available
#ifdef ENABLE_GIO
    try {
      gio::addMountMetadata(mountPoint, metadata);
    } catch (const std::exception &e) {
      // Log error but continue - GIO metadata is optional
      metadata.status = std::string("GIO warning: ") + e.what();
    }
#endif

    // Optional blkid metadata if available
    if (!options_.device.empty()) {
      try {
        BlkidCache cache;
        char *uuid =
            blkid_get_tag_value(cache.get(), "UUID", options_.device.c_str());
        if (uuid) {
          metadata.uuid = uuid;
          free(uuid);
        }

        char *label =
            blkid_get_tag_value(cache.get(), "LABEL", options_.device.c_str());
        if (label) {
          metadata.label = label;
          free(label);
        }
      } catch (const std::exception &e) {
        // Log error but continue - blkid metadata is optional
        metadata.status = std::string("Blkid warning: ") + e.what();
      }
    }

  } catch (const std::exception &e) {
    SetError(e.what());
  }
}

void GetVolumeMetadataWorker::OnOK() {
  Napi::HandleScope scope(Env());
  Napi::Object result = Napi::Object::New(Env());

  result.Set("mountPoint", mountPoint);
  result.Set("size", metadata.size);
  result.Set("used", metadata.used);
  result.Set("available", metadata.available);
  result.Set("ok", metadata.ok);

  if (!metadata.label.empty()) {
    result.Set("label", metadata.label);
  }
  if (!metadata.uuid.empty()) {
    result.Set("uuid", metadata.uuid);
  }
  if (!metadata.status.empty()) {
    result.Set("status", metadata.status);
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
  if (!metadata.uri.empty()) {
    result.Set("uri", metadata.uri);
  }

  if (!metadata.fileSystem.empty()) {
    result.Set("fileSystem", metadata.fileSystem);
  }

  deferred_.Resolve(result);
}

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

  auto *worker = new GetVolumeMetadataWorker(mountPoint, opts, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta