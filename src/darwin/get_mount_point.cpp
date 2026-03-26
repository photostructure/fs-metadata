// src/darwin/get_mount_point.cpp
// Lightweight mount point lookup using fstatfs() only.
// Returns f_mntonname without DiskArbitration, IOKit, or space calculations.

#include "./get_mount_point.h"
#include "../common/debug_log.h"
#include "../common/error_utils.h"
#include "../common/fd_guard.h"
#include "../common/path_security.h"

#include <fcntl.h>
#include <string>
#include <sys/mount.h>
#include <sys/param.h>
#include <unistd.h>

namespace FSMeta {

class GetMountPointWorker : public Napi::AsyncWorker {
public:
  GetMountPointWorker(const std::string &path,
                      const Napi::Promise::Deferred &deferred)
      : Napi::AsyncWorker(deferred.Env()), path_(path), deferred_(deferred) {}

  void Execute() override {
    DEBUG_LOG("[GetMountPointWorker] Executing for path: %s", path_.c_str());
    try {
      std::string error;
      std::string validated = ValidatePathForRead(path_, error);
      if (validated.empty()) {
        SetError(error);
        return;
      }

      DEBUG_LOG("[GetMountPointWorker] Using validated path: %s",
                validated.c_str());

      int fd = open(validated.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
      if (fd < 0) {
        int err = errno;
        DEBUG_LOG("[GetMountPointWorker] open failed: %s (%d)", strerror(err),
                  err);
        SetError(CreatePathErrorMessage("open", path_, err));
        return;
      }

      FdGuard guard(fd);

      struct statfs fs;
      if (fstatfs(fd, &fs) != 0) {
        int err = errno;
        DEBUG_LOG("[GetMountPointWorker] fstatfs failed: %s (%d)",
                  strerror(err), err);
        SetError(CreatePathErrorMessage("fstatfs", path_, err));
        return;
      }

      result_ = fs.f_mntonname;
      DEBUG_LOG("[GetMountPointWorker] mount point: %s", result_.c_str());
    } catch (const std::exception &e) {
      DEBUG_LOG("[GetMountPointWorker] Exception: %s", e.what());
      SetError(e.what());
    }
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    deferred_.Resolve(Napi::String::New(Env(), result_));
  }

  void OnError(const Napi::Error &error) override {
    deferred_.Reject(error.Value());
  }

private:
  std::string path_;
  std::string result_;
  Napi::Promise::Deferred deferred_;
};

Napi::Value GetMountPoint(const Napi::CallbackInfo &info) {
  auto env = info.Env();
  DEBUG_LOG("[GetMountPoint] called");

  if (info.Length() < 1 || !info[0].IsString()) {
    throw Napi::TypeError::New(env, "String argument expected");
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GetMountPointWorker(path, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta
