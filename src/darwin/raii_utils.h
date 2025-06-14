#pragma once

#include <CoreFoundation/CoreFoundation.h>
#include <sys/mount.h>

// RAII (Resource Acquisition Is Initialization) utilities for macOS APIs.
// These wrappers ensure proper cleanup of system resources even in the
// presence of exceptions, preventing memory leaks and resource exhaustion.

namespace FSMeta {

// Generic RAII wrapper for resources that need free().
// This is used for C-style allocations that must be freed with free().
// Common usage: buffers returned by system APIs like getmntinfo_r_np().
template <typename T> class ResourceRAII {
private:
  T *resource_;

public:
  ResourceRAII() : resource_(nullptr) {}
  ~ResourceRAII() {
    if (resource_) {
      free(resource_);
    }
  }

  T **ptr() { return &resource_; }
  T *get() { return resource_; }

  // Add move operations for better resource management
  ResourceRAII(ResourceRAII &&other) noexcept : resource_(other.resource_) {
    other.resource_ = nullptr;
  }

  ResourceRAII &operator=(ResourceRAII &&other) noexcept {
    if (this != &other) {
      if (resource_)
        free(resource_);
      resource_ = other.resource_;
      other.resource_ = nullptr;
    }
    return *this;
  }

  // Prevent copying
  ResourceRAII(const ResourceRAII &) = delete;
  ResourceRAII &operator=(const ResourceRAII &) = delete;
};

// Specialized RAII wrapper for mount buffer from getmntinfo_r_np().
// getmntinfo_r_np() allocates a buffer that the caller must free.
// This wrapper ensures the buffer is freed even if exceptions occur.
class MountBufferRAII {
private:
  struct statfs *buffer_;

public:
  MountBufferRAII() : buffer_(nullptr) {}
  ~MountBufferRAII() {
    if (buffer_) {
      free(buffer_);
    }
  }

  struct statfs **ptr() { return &buffer_; }
  struct statfs *get() { return buffer_; }

  // Add move operations for better resource management
  MountBufferRAII(MountBufferRAII &&other) noexcept : buffer_(other.buffer_) {
    other.buffer_ = nullptr;
  }

  MountBufferRAII &operator=(MountBufferRAII &&other) noexcept {
    if (this != &other) {
      if (buffer_)
        free(buffer_);
      buffer_ = other.buffer_;
      other.buffer_ = nullptr;
    }
    return *this;
  }

  // Prevent copying
  MountBufferRAII(const MountBufferRAII &) = delete;
  MountBufferRAII &operator=(const MountBufferRAII &) = delete;
};

// CoreFoundation RAII wrapper following the Create/Copy/Get rule.
// Any CF object obtained via Create or Copy functions must be released.
// This wrapper automatically calls CFRelease() in the destructor,
// preventing memory leaks from Core Foundation objects.
template <typename T> class CFReleaser {
private:
  T ref_;

public:
  explicit CFReleaser(T ref = nullptr) noexcept : ref_(ref) {}
  ~CFReleaser() { reset(); }

  void reset(T ref = nullptr) {
    if (ref_) {
      CFRelease(ref_);
    }
    ref_ = ref;
  }

  operator T() const noexcept { return ref_; }
  T get() const noexcept { return ref_; }
  bool isValid() const noexcept { return ref_ != nullptr; }

  // Prevent copying
  CFReleaser(const CFReleaser &) = delete;
  CFReleaser &operator=(const CFReleaser &) = delete;

  // Allow moving
  CFReleaser(CFReleaser &&other) noexcept : ref_(other.ref_) {
    other.ref_ = nullptr;
  }
  CFReleaser &operator=(CFReleaser &&other) noexcept {
    if (this != &other) {
      reset();
      ref_ = other.ref_;
      other.ref_ = nullptr;
    }
    return *this;
  }
};

} // namespace FSMeta
