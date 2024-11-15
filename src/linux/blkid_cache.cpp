// src/linux/blkid_cache.cpp
#include "blkid_cache.h"
#include <stdexcept>

namespace FSMeta {

std::mutex BlkidCache::mutex_;

BlkidCache::BlkidCache() : cache_(nullptr) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (blkid_get_cache(&cache_, nullptr) != 0) {
    throw std::runtime_error("Failed to get blkid cache");
  }
}

BlkidCache::~BlkidCache() {
  if (cache_) {
    std::lock_guard<std::mutex> lock(mutex_);
    blkid_put_cache(cache_);
  }
}

} // namespace FSMeta