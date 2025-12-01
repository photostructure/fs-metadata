// src/common/fd_guard.h
// RAII wrapper for POSIX file descriptors
// Ensures file descriptors are properly closed, even when exceptions occur

#pragma once

#include <unistd.h>

namespace FSMeta {

/**
 * RAII guard for POSIX file descriptors.
 *
 * Automatically closes the file descriptor when destroyed, preventing
 * resource leaks. Particularly important for:
 * - Exception safety (fd closed even if exception thrown)
 * - Early returns (fd closed regardless of return path)
 * - Fork safety (when combined with O_CLOEXEC)
 *
 * Usage:
 *   int fd = open(path, O_RDONLY | O_CLOEXEC);
 *   if (fd < 0) { handle error }
 *   FdGuard guard(fd);
 *   // fd is automatically closed when guard goes out of scope
 */
class FdGuard {
public:
  explicit FdGuard(int fd) noexcept : fd_(fd) {}

  ~FdGuard() noexcept {
    if (fd_ >= 0) {
      close(fd_);
    }
  }

  // Get the underlying file descriptor
  int get() const noexcept { return fd_; }

  // Release ownership of the file descriptor (caller must close it)
  int release() noexcept {
    int fd = fd_;
    fd_ = -1;
    return fd;
  }

  // Check if the guard holds a valid file descriptor
  bool isValid() const noexcept { return fd_ >= 0; }

  // Non-copyable
  FdGuard(const FdGuard &) = delete;
  FdGuard &operator=(const FdGuard &) = delete;

  // Movable
  FdGuard(FdGuard &&other) noexcept : fd_(other.fd_) { other.fd_ = -1; }

  FdGuard &operator=(FdGuard &&other) noexcept {
    if (this != &other) {
      if (fd_ >= 0) {
        close(fd_);
      }
      fd_ = other.fd_;
      other.fd_ = -1;
    }
    return *this;
  }

private:
  int fd_;
};

} // namespace FSMeta
