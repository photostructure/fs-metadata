// src/linux/blkid_cache.h

#pragma once
#include <blkid/blkid.h>
#include <mutex>

namespace FSMeta {

// Thread-safe helper class for RAII handling of blkid cache
class BlkidCache {
private:
  static std::mutex mutex_;
  blkid_cache cache_;

public:
  BlkidCache();
  ~BlkidCache();

  // Returns the blkid cache pointer
  blkid_cache get();

  operator bool() const { return cache_ != nullptr; }

  // Prevent copying - each instance owns its cache
  BlkidCache(const BlkidCache &) = delete;
  BlkidCache &operator=(const BlkidCache &) = delete;

  // Allow moving - transfers ownership of the cache
  BlkidCache(BlkidCache &&other) noexcept : cache_(other.cache_) {
    other.cache_ = nullptr;
  }
  BlkidCache &operator=(BlkidCache &&other) noexcept {
    if (this != &other) {
      // Release current cache if any (under lock)
      if (cache_) {
        const std::lock_guard<std::mutex> lock(mutex_);
        if (cache_) {
          blkid_put_cache(cache_);
        }
      }
      // Take ownership from other
      cache_ = other.cache_;
      other.cache_ = nullptr;
    }
    return *this;
  }
};

} // namespace FSMeta
