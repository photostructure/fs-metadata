// src/linux/blkid_cache.cpp
#include "blkid_cache.h"
#include <stdexcept>

namespace FSMeta {

// Define the static mutex
std::mutex BlkidCache::mutex_;

// Constructor: Initializes the blkid cache with proper error handling
BlkidCache::BlkidCache() : cache_(nullptr) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (blkid_get_cache(&cache_, nullptr) != 0) {
    throw std::runtime_error("Failed to initialize blkid cache");
  }
}

// Destructor: Safely releases the blkid cache resource
BlkidCache::~BlkidCache() {
  if (cache_) {
    std::lock_guard<std::mutex> lock(mutex_);
    try {
      blkid_put_cache(cache_);
      cache_ = nullptr; // Avoid double-release
    } catch (const std::exception &e) {
      // Optional: Log error during cache cleanup
      // std::cerr << "Error while releasing blkid cache: " << e.what()
      //           << std::endl;
    }
  }
}

// Accessor for blkid cache
blkid_cache BlkidCache::get() {
  if (!cache_) {
    throw std::runtime_error(
        "blkid cache is uninitialized or has been released");
  }
  return cache_;
}

} // namespace FSMeta
