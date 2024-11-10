// src/linux/fs_meta.cpp
#include "fs_meta.h"

#include <blkid/blkid.h>
#include <mntent.h>
#include <sys/statvfs.h>
#include <sys/stat.h>
#include <unistd.h>

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace FSMeta {

GetVolumeMetadataWorker::GetVolumeMetadataWorker(
    const std::string& path,
    const Napi::Promise::Deferred& deferred)
    : Napi::AsyncWorker(deferred.Env()),
      mountPoint(path),
      deferred_(deferred) {}

namespace {
bool isNetworkFileSystem(const char* fstype) {
  static const char* network_fs[] = {
      "nfs", "nfs4", "cifs", "smb", "smbfs", "ncpfs", "afs", nullptr
  };

  for (const char** fs = network_fs; *fs; fs++) {
    if (strcmp(fstype, *fs) == 0) {
      return true;
    }
  }
  return false;
}

std::string getRemoteHost(const std::string& source) {
  size_t pos = source.find("://");
  if (pos != std::string::npos) {
    pos += 3;
    size_t end = source.find('/', pos);
    if (end != std::string::npos) {
      return source.substr(pos, end - pos);
    }
    return source.substr(pos);
  }

  if (source.find("//") == 0) {
    size_t start = 2;
    size_t end = source.find('/', start);
    if (end != std::string::npos) {
      return source.substr(start, end - start);
    }
  }

  return "";
}

std::string getRemoteShare(const std::string& source) {
  size_t pos = source.find_last_of('/');
  if (pos != std::string::npos && pos + 1 < source.length()) {
    return source.substr(pos + 1);
  }
  return "";
}
}  // namespace

void GetVolumeMetadataWorker::Execute() {
  try {
    struct statvfs vfs;
    struct stat st;

    // Get basic filesystem stats
    if (statvfs(mountPoint.c_str(), &vfs) != 0) {
      throw std::runtime_error("Failed to get file system statistics");
    }

    if (stat(mountPoint.c_str(), &st) != 0) {
      throw std::runtime_error("Failed to get mount point statistics");
    }

    // Find the filesystem type and source
    FILE* mtab = setmntent("/etc/mtab", "r");
    if (!mtab) {
      throw std::runtime_error("Failed to open /etc/mtab");
    }

    struct mntent* ent;
    std::string fstype, source;
    bool found = false;

    while ((ent = getmntent(mtab)) != nullptr) {
      if (strcmp(ent->mnt_dir, mountPoint.c_str()) == 0) {
        fstype = ent->mnt_type;
        source = ent->mnt_fsname;
        found = true;
        break;
      }
    }
    endmntent(mtab);

    if (!found) {
      throw std::runtime_error("Mountpoint not found in /etc/mtab");
    }

    // Get UUID and label using blkid
    blkid_cache cache;
    if (blkid_get_cache(&cache, nullptr) == 0) {
      blkid_dev dev = blkid_get_dev(cache, source.c_str(), BLKID_DEV_NORMAL);
      if (dev) {
        char* uuid = blkid_get_tag_value(cache, "UUID", source.c_str());
        char* label = blkid_get_tag_value(cache, "LABEL", source.c_str());
        
        if (uuid) {
          metadata.uuid = uuid;
          free(uuid);
        }
        if (label) {
          metadata.label = label;
          free(label);
        }
      }
      blkid_put_cache(cache);
    }

    // Calculate sizes
    uint64_t blockSize = vfs.f_frsize ? vfs.f_frsize : vfs.f_bsize;
    metadata.size = blockSize * vfs.f_blocks;
    metadata.available = blockSize * vfs.f_bavail;
    metadata.used = metadata.size - (blockSize * vfs.f_bfree);
    metadata.filesystem = fstype;

    // Check if it's a remote filesystem
    metadata.remote = isNetworkFileSystem(fstype.c_str());
    if (metadata.remote) {
      metadata.remoteHost = getRemoteHost(source);
      metadata.remoteShare = getRemoteShare(source);
    }

    metadata.ok = true;
  } catch (const std::exception& e) {
    metadata.ok = false;
    metadata.status = e.what();
  }
}

void GetVolumeMetadataWorker::OnOK() {
  Napi::HandleScope scope(Env());
  Napi::Object result = Napi::Object::New(Env());

  result.Set("mountPoint", mountPoint);
  result.Set("fileSystem", metadata.fileSystem);
  result.Set("size", Napi::Number::New(Env(), static_cast<double>(metadata.size)));
  result.Set("used", Napi::Number::New(Env(), static_cast<double>(metadata.used)));
  result.Set("available", Napi::Number::New(Env(), static_cast<double>(metadata.available)));
  result.Set("remote", Napi::Boolean::New(Env(), metadata.remote));
  result.Set("ok", Napi::Boolean::New(Env(), metadata.ok));

  if (!metadata.label.empty()) {
    result.Set("label", metadata.label);
  }
  if (!metadata.uuid.empty()) {
    result.Set("uuid", metadata.uuid);
  }
  if (metadata.remote) {
    if (!metadata.remoteHost.empty()) {
      result.Set("remoteHost", metadata.remoteHost);
    }
    if (!metadata.remoteShare.empty()) {
      result.Set("remoteShare", metadata.remoteShare);
    }
  }
  if (!metadata.ok && !metadata.status.empty()) {
    result.Set("status", metadata.status);
  }

  deferred_.Resolve(result);
}

Napi::Value GetVolumeMetadata(Napi::Env env, const std::string& mountPoint) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto* worker = new GetVolumeMetadataWorker(mountPoint, deferred);
  worker->Queue();
  return deferred.Promise();
}

}  // namespace FSMeta