#pragma once

#include <CoreFoundation/CoreFoundation.h>
#include <sys/mount.h>

namespace FSMeta {

// Generic RAII wrapper for resources that need free()
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

// Specialized for mount info
using MountBufferRAII = ResourceRAII<struct statfs>;

// CoreFoundation RAII wrapper
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
