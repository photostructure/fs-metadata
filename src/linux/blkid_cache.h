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

  blkid_cache get() { return cache_; }
  operator bool() const { return cache_ != nullptr; }

  BlkidCache(const BlkidCache &) = delete;
  BlkidCache &operator=(const BlkidCache &) = delete;
};

} // namespace FSMeta
