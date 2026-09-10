// src/darwin/get_mount_point.cpp
// Lightweight mount point lookup using fstatfs() only.
// Returns f_mntonname without DiskArbitration, IOKit, or space calculations.

#include "./get_mount_point.h"
#include "../common/debug_log.h"
#include "../common/error_utils.h"
#include "../common/fd_guard.h"
#include "../common/path_security.h"
#include "../common/volume_mount_points.h"
#include "./native_job.h"

#include <fcntl.h>
#include <string>
#include <sys/mount.h>
#include <sys/param.h>
#include <sys/stat.h>
#include <unistd.h>

namespace FSMeta {

class GetMountPointWorker : public NativeJob {
public:
  GetMountPointWorker(const std::string &path, uint32_t timeoutMs)
      : NativeJob(timeoutMs), path_(path) {}

  void Execute() override {
    DEBUG_LOG("[GetMountPointWorker] Executing for path: %s", path_.c_str());
    try {
      std::string error;
      int errorCode = 0;
      std::string validated = ValidatePathForRead(path_, error, &errorCode);
      if (validated.empty()) {
        SetError(error, errorCode, "realpath", path_);
        return;
      }

      struct stat pathStat;
      if (stat(validated.c_str(), &pathStat) != 0) {
        const int err = errno;
        SetError(CreatePathErrorMessage("stat", path_, err), err, "stat",
                 path_);
        return;
      }
      if (!S_ISDIR(pathStat.st_mode)) {
        const auto slash = validated.find_last_of('/');
        validated = slash == 0 ? "/" : validated.substr(0, slash);
      }
      if (IsCancelled())
        return;

      DEBUG_LOG("[GetMountPointWorker] Using validated path: %s",
                validated.c_str());

      int fd = open(validated.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
      if (fd < 0) {
        int err = errno;
        DEBUG_LOG("[GetMountPointWorker] open failed: %s (%d)", strerror(err),
                  err);
        SetError(CreatePathErrorMessage("open", path_, err), err, "open",
                 path_);
        return;
      }

      FdGuard guard(fd);

      struct statfs fs;
      if (fstatfs(fd, &fs) != 0) {
        int err = errno;
        DEBUG_LOG("[GetMountPointWorker] fstatfs failed: %s (%d)",
                  strerror(err), err);
        SetError(CreatePathErrorMessage("fstatfs", path_, err), err, "fstatfs",
                 path_);
        return;
      }

      result_ = fs.f_mntonname;
      DEBUG_LOG("[GetMountPointWorker] mount point: %s", result_.c_str());
    } catch (const std::exception &e) {
      DEBUG_LOG("[GetMountPointWorker] Exception: %s", e.what());
      SetError(e.what());
    }
  }

  Napi::Value ToValue(Napi::Env env) override {
    return Napi::String::New(env, result_);
  }

private:
  std::string path_;
  std::string result_;
};

Napi::Value GetMountPoint(const Napi::CallbackInfo &info) {
  auto env = info.Env();
  DEBUG_LOG("[GetMountPoint] called");

  if (info.Length() < 1 || !info[0].IsString()) {
    throw Napi::TypeError::New(env, "String argument expected");
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  MountPointOptions options;
  if (info.Length() > 1 && info[1].IsObject()) {
    options = MountPointOptions::FromObject(info[1].As<Napi::Object>());
  }
  return QueueNativeJob(
      env, std::make_shared<GetMountPointWorker>(path, options.timeoutMs));
}

} // namespace FSMeta
