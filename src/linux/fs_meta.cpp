// src/linux/fs_meta.cpp
#include "fs_meta.h"
#include "blkid_cache.h"
#include <blkid/blkid.h>
#include <cerrno>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>
#include <sys/statvfs.h>

#ifdef ENABLE_GIO
#include "gio_utils.h"
std::vector<FSMeta::TypedMountPoint> FSMeta::getGioMountPoints() {
  return FSMeta::gio::getMountPoints();
}
#endif

namespace FSMeta {
namespace {

void addBlkidMetadata(const char *device, VolumeMetadata &metadata) {
  try {
    BlkidCache cache;

    char *uuid = blkid_get_tag_value(cache.get(), "UUID", device);
    if (uuid) {
      metadata.uuid = uuid;
      free(uuid);
    }

    char *label = blkid_get_tag_value(cache.get(), "LABEL", device);
    if (label) {
      metadata.label = label;
      free(label);
    }
  } catch (const std::exception &e) {
    metadata.status = std::string("Warning: ") + e.what();
  }
}

} // namespace

void GetVolumeMetadataWorker::Execute() {
  try {
    struct statvfs vfs;
    if (statvfs(mountPoint.c_str(), &vfs) != 0) {
      throw std::runtime_error(
          std::string("Failed to get volume statistics: ") + strerror(errno));
    }

    uint64_t blockSize = vfs.f_frsize ? vfs.f_frsize : vfs.f_bsize;
    metadata.size = static_cast<double>(blockSize) * vfs.f_blocks;
    metadata.available = static_cast<double>(blockSize) * vfs.f_bavail;
    metadata.used =
        metadata.size - (static_cast<double>(blockSize) * vfs.f_bfree);
    metadata.ok = true;

#ifdef ENABLE_GIO
    gio::addMountMetadata(mountPoint, metadata);
#endif

    // Add block device metadata if we have a device path
    if (!options_.device.empty()) {
      addBlkidMetadata(options_.device.c_str(), metadata);
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

  deferred_.Resolve(result);
}

void GetVolumeMetadataWorker::OnError(const Napi::Error &error) {
  deferred_.Reject(error.Value());
}

VolumeMetadataOptions parseOptions(const Napi::Object &options) {
  VolumeMetadataOptions opts;

  if (options.Has("timeoutMs")) {
    opts.timeoutMs = options.Get("timeoutMs").As<Napi::Number>().Uint32Value();
  } else {
    opts.timeoutMs = 5000;
  }

  if (options.Has("device")) {
    opts.device = options.Get("device").As<Napi::String>().Utf8Value();
  }

  return opts;
}

Napi::Value GetVolumeMetadata(Napi::Env env, const std::string &mountPoint,
                              const Napi::Object &options) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto opts = parseOptions(options);
  auto *worker = new GetVolumeMetadataWorker(mountPoint, opts, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta