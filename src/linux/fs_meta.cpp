// src/linux/fs_meta.cpp
#include "fs_meta.h"

#include <blkid/blkid.h>
#include <mntent.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <unistd.h>

#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace FSMeta {

namespace {
// Helper to ensure proper cleanup of blkid resources
class BlkidCacheReleaser {
private:
  blkid_cache cache_;

public:
  explicit BlkidCacheReleaser(blkid_cache cache) : cache_(cache) {}
  ~BlkidCacheReleaser() {
    if (cache_) {
      blkid_put_cache(cache_);
    }
  }

  blkid_cache get() const { return cache_; }

  // Prevent copying
  BlkidCacheReleaser(const BlkidCacheReleaser &) = delete;
  BlkidCacheReleaser &operator=(const BlkidCacheReleaser &) = delete;
};

// Helper to ensure proper cleanup of FILE* resources
class FileCloser {
private:
  FILE *file_;

public:
  explicit FileCloser(FILE *file) : file_(file) {}
  ~FileCloser() {
    if (file_) {
      fclose(file_);
    }
  }

  FILE *get() const { return file_; }

  // Prevent copying
  FileCloser(const FileCloser &) = delete;
  FileCloser &operator=(const FileCloser &) = delete;
};

bool isNetworkFileSystem(const char *fstype) {
  static const char *network_fs[] = {"nfs",        "nfs4",      "cifs", "smb",
                                     "smbfs",      "ncpfs",     "afs",  "davfs",
                                     "fuse.sshfs", "glusterfs", nullptr};

  for (const char **fs = network_fs; *fs; fs++) {
    if (strcmp(fstype, *fs) == 0) {
      return true;
    }
  }
  return false;
}

std::string getRemoteHost(const std::string &source) {
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

  // Try to parse traditional NFS format (host:/path)
  size_t colonPos = source.find(':');
  if (colonPos != std::string::npos && colonPos > 0) {
    return source.substr(0, colonPos);
  }

  return "";
}

std::string getRemoteShare(const std::string &source) {
  // First try URL-style paths
  size_t pos = source.find("://");
  if (pos != std::string::npos) {
    pos = source.find('/', pos + 3);
    if (pos != std::string::npos) {
      return source.substr(pos + 1);
    }
    return "";
  }

  // Try SMB/CIFS style paths
  if (source.find("//") == 0) {
    size_t start = source.find('/', 2);
    if (start != std::string::npos) {
      return source.substr(start + 1);
    }
    return "";
  }

  // Try NFS style paths (host:/path)
  size_t colonPos = source.find(':');
  if (colonPos != std::string::npos && colonPos + 1 < source.length()) {
    return source.substr(colonPos + 1);
  }

  return "";
}

} // anonymous namespace

GetVolumeMetadataWorker::GetVolumeMetadataWorker(
    const std::string &path, const Napi::Promise::Deferred &deferred)
    : Napi::AsyncWorker(deferred.Env()), mountPoint(path), deferred_(deferred) {
}

void GetVolumeMetadataWorker::Execute() {
  try {
    struct statvfs vfs;
    struct stat st;

    // Get basic filesystem stats
    if (statvfs(mountPoint.c_str(), &vfs) != 0) {
      throw std::runtime_error("Failed to get filesystem statistics");
    }

    if (stat(mountPoint.c_str(), &st) != 0) {
      throw std::runtime_error("Failed to get mount point statistics");
    }

    // Find the filesystem type and source
    FileCloser mtab(setmntent("/etc/mtab", "r"));
    if (!mtab.get()) {
      throw std::runtime_error("Failed to open /etc/mtab");
    }

    struct mntent *ent;
    std::string fstype, source;
    bool found = false;

    while ((ent = getmntent(mtab.get())) != nullptr) {
      if (strcmp(ent->mnt_dir, mountPoint.c_str()) == 0) {
        fstype = ent->mnt_type;
        source = ent->mnt_fsname;
        found = true;
        break;
      }
    }

    if (!found) {
      throw std::runtime_error("Mount point not found in /etc/mtab");
    }

    // Calculate sizes using uint64_t to prevent overflow
    uint64_t blockSize = vfs.f_frsize ? vfs.f_frsize : vfs.f_bsize;

    // Calculate total size first
    metadata.size =
        static_cast<double>(blockSize) * static_cast<double>(vfs.f_blocks);

    // Calculate available space
    metadata.available =
        static_cast<double>(blockSize) * static_cast<double>(vfs.f_bavail);

    // Calculate used space as the difference between total and free
    double totalFree =
        static_cast<double>(blockSize) * static_cast<double>(vfs.f_bfree);
    metadata.used = metadata.size - totalFree;

    // Sanity check to ensure used + available <= size
    if (metadata.used + metadata.available > metadata.size) {
      metadata.used = metadata.size - metadata.available;
    }

    metadata.fileSystem = fstype;

    // Get UUID and label using blkid
    blkid_cache cache;
    if (blkid_get_cache(&cache, nullptr) == 0) {
      BlkidCacheReleaser cacheReleaser(cache);

      blkid_dev dev = blkid_get_dev(cache, source.c_str(), BLKID_DEV_NORMAL);
      if (dev) {
        char *uuid = blkid_get_tag_value(cache, "UUID", source.c_str());
        if (uuid) {
          metadata.uuid = uuid;
          free(uuid);
        }

        char *label = blkid_get_tag_value(cache, "LABEL", source.c_str());
        if (label) {
          metadata.label = label;
          free(label);
        }
      }
    }

    // Check if it's a remote filesystem
    metadata.remote = isNetworkFileSystem(fstype.c_str());
    if (metadata.remote) {
      metadata.remoteHost = getRemoteHost(source);
      metadata.remoteShare = getRemoteShare(source);
    }

    metadata.ok = true;
  } catch (const std::exception &e) {
    metadata.ok = false;
    metadata.status = e.what();
    SetError(e.what());
  }
}

void GetVolumeMetadataWorker::OnOK() {
  Napi::HandleScope scope(Env());
  Napi::Object result = Napi::Object::New(Env());

  result.Set("mountPoint", mountPoint);
  result.Set("fileSystem", metadata.fileSystem);
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
  if (metadata.remote) {
    result.Set("remote", Napi::Boolean::New(Env(), true));
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

Napi::Value GetVolumeMetadata(Napi::Env env, const std::string &mountPoint) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GetVolumeMetadataWorker(mountPoint, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta