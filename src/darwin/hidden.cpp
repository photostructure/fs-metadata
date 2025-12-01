// src/darwin/hidden.cpp
#include "hidden.h"
#include "../common/debug_log.h"
#include "../common/error_utils.h"
#include "../common/fd_guard.h"
#include "../common/path_security.h"
#include <fcntl.h>  // for open(), O_RDONLY, O_CLOEXEC
#include <string.h> // for strcmp
#include <sys/mount.h>
#include <sys/stat.h>
#include <unistd.h>

namespace FSMeta {

GetHiddenWorker::GetHiddenWorker(std::string path,
                                 Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(deferred.Env()), path_(std::move(path)),
      deferred_(deferred), is_hidden_(false) {
  DEBUG_LOG("[GetHiddenWorker] created for path: %s", path_.c_str());
}

void GetHiddenWorker::Execute() {
  DEBUG_LOG("[GetHiddenWorker] checking hidden status for: %s", path_.c_str());

  // Validate and canonicalize path using realpath() to prevent directory
  // traversal This follows Apple's Secure Coding Guide recommendations For
  // isHidden(), we allow non-existent paths (they will fail stat() below)
  std::string error;
  std::string validated_path = ValidateAndCanonicalizePath(path_, error, true);
  if (validated_path.empty()) {
    // If validation failed, check if it's because the path doesn't exist
    // In that case, return the expected "Path not found" error for TypeScript
    // layer
    if (error.find("realpath") != std::string::npos &&
        error.find("No such file or directory") != std::string::npos) {
      SetError("Path not found: '" + path_ + "'");
    } else {
      SetError(error);
    }
    return;
  }

  // Use the validated path for all subsequent operations
  DEBUG_LOG("[GetHiddenWorker] Using validated path: %s",
            validated_path.c_str());

  // SECURITY: Use file descriptor-based approach to prevent TOCTOU race
  // condition. Opening the file and using fstat() on the fd ensures we're
  // checking the same file that realpath() validated.
  // O_CLOEXEC: Prevent fd leak to child processes on fork/exec
  // O_RDONLY: We only need to read the flags
  int fd = open(validated_path.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    int error = errno;
    if (error == ENOENT) {
      DEBUG_LOG("[GetHiddenWorker] path not found: %s", validated_path.c_str());
      SetError("Path not found: '" + validated_path + "'");
    } else {
      DEBUG_LOG("[GetHiddenWorker] failed to open path %s: %s (%d)",
                validated_path.c_str(), strerror(error), error);
      SetError(CreatePathErrorMessage("open", validated_path, error));
    }
    return;
  }
  FdGuard fd_guard(fd);

  struct stat statbuf;
  if (fstat(fd, &statbuf) != 0) {
    int error = errno;
    DEBUG_LOG("[GetHiddenWorker] failed to fstat path %s: %s (%d)",
              validated_path.c_str(), strerror(error), error);
    SetError(CreatePathErrorMessage("fstat", validated_path, error));
    return;
  }

  is_hidden_ = (statbuf.st_flags & UF_HIDDEN) != 0;
  DEBUG_LOG("[GetHiddenWorker] path %s is %s", validated_path.c_str(),
            is_hidden_ ? "hidden" : "not hidden");
}

void GetHiddenWorker::OnOK() {
  Napi::HandleScope scope(Env());
  auto env = Env();
  deferred_.Resolve(Napi::Boolean::New(env, is_hidden_));
}

void GetHiddenWorker::OnError(const Napi::Error &error) {
  Napi::HandleScope scope(Env());
  deferred_.Reject(error.Value());
}

Napi::Promise GetHiddenAttribute(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  DEBUG_LOG("[GetHiddenAttribute] called");

  if (info.Length() < 1 || !info[0].IsString()) {
    DEBUG_LOG("[GetHiddenAttribute] invalid arguments");
    auto error = Napi::Error::New(env, "String path expected");
    auto deferred = Napi::Promise::Deferred::New(env);
    deferred.Reject(error.Value());
    return deferred.Promise();
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  DEBUG_LOG("[GetHiddenAttribute] getting hidden status for: %s", path.c_str());
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GetHiddenWorker(path, deferred);
  worker->Queue();
  return deferred.Promise();
}

SetHiddenWorker::SetHiddenWorker(std::string path, bool hidden,
                                 Napi::Promise::Deferred deferred)
    : Napi::AsyncWorker(deferred.Env()), path_(std::move(path)),
      hidden_(hidden), deferred_(deferred) {
  DEBUG_LOG("[SetHiddenWorker] created for path: %s, hidden: %d", path_.c_str(),
            hidden_);
}

void SetHiddenWorker::Execute() {
  DEBUG_LOG("[SetHiddenWorker] setting hidden=%d for: %s", hidden_,
            path_.c_str());

  // macOS uses BSD file flags (UF_HIDDEN) to control file visibility.
  // This is different from the dot-prefix convention used on Unix systems.
  // The chflags() system call modifies these BSD-specific file flags.

  // Validate and canonicalize path using realpath() to prevent directory
  // traversal This follows Apple's Secure Coding Guide recommendations For
  // setHidden, the file must exist, so we use ValidatePathForRead
  std::string error;
  std::string validated_path = ValidatePathForRead(path_, error);
  if (validated_path.empty()) {
    SetError(error);
    return;
  }

  // Use the validated path for all subsequent operations
  DEBUG_LOG("[SetHiddenWorker] Using validated path: %s",
            validated_path.c_str());

  // SECURITY: Use file descriptor-based approach to prevent TOCTOU race
  // condition. Opening the file, reading flags with fstat(), and setting
  // flags with fchflags() all operate on the same inode via the fd.
  // O_CLOEXEC: Prevent fd leak to child processes on fork/exec
  // O_RDONLY: fchflags() doesn't require write access to the file contents
  int fd = open(validated_path.c_str(), O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    int error = errno;
    if (error == ENOENT) {
      DEBUG_LOG("[SetHiddenWorker] path not found: %s", validated_path.c_str());
      SetError("Path not found: '" + validated_path + "'");
    } else {
      DEBUG_LOG("[SetHiddenWorker] failed to open path %s: %s (%d)",
                validated_path.c_str(), strerror(error), error);
      SetError(CreatePathErrorMessage("open", validated_path, error));
    }
    return;
  }
  FdGuard fd_guard(fd);

  struct stat statbuf;
  if (fstat(fd, &statbuf) != 0) {
    int error = errno;
    DEBUG_LOG("[SetHiddenWorker] failed to fstat path %s: %s (%d)",
              validated_path.c_str(), strerror(error), error);
    SetError(CreatePathErrorMessage("fstat", validated_path, error));
    return;
  }

  u_int32_t new_flags;
  if (hidden_) {
    new_flags = statbuf.st_flags | UF_HIDDEN;
  } else {
    new_flags = statbuf.st_flags & ~UF_HIDDEN;
  }

  if (fchflags(fd, new_flags) != 0) {
    int error = errno;
    DEBUG_LOG("[SetHiddenWorker] failed to set flags for %s: %s (%d)",
              validated_path.c_str(), strerror(error), error);

    // Check if this is an APFS filesystem issue using fstatfs on the fd
    struct statfs fs;
    bool is_apfs = false;
    if (fstatfs(fd, &fs) == 0) {
      is_apfs = (strcmp(fs.f_fstypename, "apfs") == 0);
      DEBUG_LOG("[SetHiddenWorker] filesystem type: %s", fs.f_fstypename);
    }

    // Provide more detailed error message for APFS
    if (is_apfs && (error == EPERM || error == ENOTSUP)) {
      SetError("Setting hidden attribute failed on APFS filesystem. "
               "This is a known issue with some APFS volumes. "
               "Error: " +
               CreatePathErrorMessage("fchflags", validated_path, error));
    } else {
      SetError(CreatePathErrorMessage("fchflags", validated_path, error));
    }
    return;
  }
  DEBUG_LOG("[SetHiddenWorker] successfully set hidden=%d for: %s", hidden_,
            validated_path.c_str());
}

void SetHiddenWorker::OnOK() {
  Napi::HandleScope scope(Env());
  auto env = Env();
  deferred_.Resolve(env.Undefined());
}

void SetHiddenWorker::OnError(const Napi::Error &error) {
  Napi::HandleScope scope(Env());
  deferred_.Reject(error.Value());
}

Napi::Promise SetHiddenAttribute(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  DEBUG_LOG("[SetHiddenAttribute] called");

  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsBoolean()) {
    DEBUG_LOG("[SetHiddenAttribute] invalid arguments");
    auto error = Napi::Error::New(
        env, "Expected arguments: (string path, boolean hidden)");
    auto deferred = Napi::Promise::Deferred::New(env);
    deferred.Reject(error.Value());
    return deferred.Promise();
  }

  std::string path = info[0].As<Napi::String>().Utf8Value();
  bool hidden = info[1].As<Napi::Boolean>().Value();
  DEBUG_LOG("[SetHiddenAttribute] setting hidden=%d for: %s", hidden,
            path.c_str());

  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new SetHiddenWorker(path, hidden, deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta