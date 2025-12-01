// src/linux/blkid_cache.cpp

#include "blkid_cache.h"
#include "../common/debug_log.h"
#include "../common/error_utils.h"
#include <stdexcept>

namespace FSMeta {

// Define the static mutex
std::mutex BlkidCache::mutex_;

// Constructor: Initializes the blkid cache with proper error handling
BlkidCache::BlkidCache() : cache_(nullptr) {
  const std::lock_guard<std::mutex> lock(mutex_);
  DEBUG_LOG("[BlkidCache] initializing cache");
  if (blkid_get_cache(&cache_, nullptr) != 0) {
    int error = errno;
    DEBUG_LOG("[BlkidCache] failed to initialize cache: errno=%d", error);
    if (error != 0) {
      throw FSException(CreateDetailedErrorMessage("blkid_get_cache", error));
    } else {
      throw FSException("Failed to initialize blkid cache (no errno set)");
    }
  }
  DEBUG_LOG("[BlkidCache] cache initialized successfully");
}

// Destructor: Safely releases the blkid cache resource
BlkidCache::~BlkidCache() {
  if (cache_) {
    const std::lock_guard<std::mutex> lock(mutex_);
    if (cache_) { // Double-check after acquiring lock
      DEBUG_LOG("[BlkidCache] releasing cache");
      // Note: blkid_put_cache() is a C function that cannot throw C++
      // exceptions, so no try-catch is needed here.
      blkid_put_cache(cache_);
      cache_ = nullptr;
      DEBUG_LOG("[BlkidCache] cache released successfully");
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
