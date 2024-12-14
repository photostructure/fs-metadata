// src/linux/blkid_cache.cpp
#include "blkid_cache.h"
#include "../common/debug_log.h"
#include <stdexcept>

namespace FSMeta {

// Define the static mutex
std::mutex BlkidCache::mutex_;

// Constructor: Initializes the blkid cache with proper error handling
BlkidCache::BlkidCache() : cache_(nullptr) {
  std::lock_guard<std::mutex> lock(mutex_);
  DEBUG_LOG("[BlkidCache] initializing cache");
  if (blkid_get_cache(&cache_, nullptr) != 0) {
    DEBUG_LOG("[BlkidCache] failed to initialize cache");
    throw std::runtime_error("Failed to initialize blkid cache");
  }
  DEBUG_LOG("[BlkidCache] cache initialized successfully");
}

// Destructor: Safely releases the blkid cache resource
BlkidCache::~BlkidCache() {
  if (cache_) {
    std::lock_guard<std::mutex> lock(mutex_);
    DEBUG_LOG("[BlkidCache] releasing cache");
    try {
      blkid_put_cache(cache_);
      cache_ = nullptr; // Avoid double-release
      DEBUG_LOG("[BlkidCache] cache released successfully");
    } catch (const std::exception &e) {
      DEBUG_LOG("[BlkidCache] error releasing cache: %s", e.what());
      // Optional: Log error during cache cleanup
      // std::cerr << "Error while releasing blkid cache: " << e.what()
      //           << std::endl;
    }
  }
}

// Accessor for blkid cache
blkid_cache BlkidCache::get() {
  if (!cache_) {
    DEBUG_LOG("[BlkidCache] attempted to access uninitialized cache");
    throw std::runtime_error(
        "blkid cache is uninitialized or has been released");
  }
  return cache_;
}

} // namespace FSMeta
