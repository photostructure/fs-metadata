// src/darwin/da_mutex.h
//
// Shared mutex for DiskArbitration operations.
//
// Apple's DiskArbitration framework does not document thread safety for
// concurrent DASession usage across threads. To prevent data races, all DA
// operations (session creation, disk description, IOKit queries via
// ClassifyMacVolume) must be serialized through this mutex.
//
// See: Finding #5 in SECURITY_AUDIT_2025.md (original)
//      Finding #2 in SECURITY_AUDIT_2026.md (mount points regression)

#pragma once

#include "./native_job.h"
#include <mutex>

namespace FSMeta {

// Never destroyed while detached OS calls might still hold it. No libuv
// thread ever waits here. Short timed waits let cancelled/expired requests
// leave the queue even if another call never releases DiskArbitration.
inline std::unique_lock<std::timed_mutex>
LockDiskArbitration(const NativeJob &job) {
  static auto *const mutex = new std::timed_mutex();
  std::unique_lock<std::timed_mutex> lock(*mutex, std::defer_lock);
  while (!job.IsCancelled()) {
    if (lock.try_lock_for(std::chrono::milliseconds(10)))
      return lock;
  }
  throw std::runtime_error(
      "DiskArbitration busy: operation timed out or cancelled");
}

} // namespace FSMeta
