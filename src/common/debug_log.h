// src/common/debug_log.h
#pragma once
#include <atomic>
#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <mutex>
#include <string>

namespace FSMeta {
namespace Debug {

// Written from the JS thread (setDebugLogging/setDebugPrefix) and read from
// async worker threads, so the flag is atomic and the prefix is
// mutex-guarded.
// std::atomic<bool> has a trivial destructor and needs no teardown handling.
inline std::atomic<bool> enableDebugLogging{false};

struct PrefixState {
  std::mutex mutex;
  std::string prefix;
};

inline PrefixState &GetPrefixState() {
#if defined(__APPLE__)
  // Detached jobs can log after environment/static teardown. Allocate lazily
  // so allocation failures do not throw during addon static initialization.
  static auto *const state = new PrefixState();
  return *state;
#else
  static PrefixState state;
  return state;
#endif
}

inline void SetDebugPrefix(const std::string &prefix) {
  auto &state = GetPrefixState();
  std::lock_guard<std::mutex> lock(state.mutex);
  state.prefix = prefix;
}

// Tell GCC/Clang that DebugLog is printf-style. This does two things:
//   1. Enables format/argument checking at every DEBUG_LOG() call site, so a
//      mismatched specifier is a compile-time diagnostic instead of UB.
//   2. Suppresses -Wformat-nonliteral (part of -Wformat=2) inside DebugLog
//      itself: forwarding a `format` parameter to vsnprintf is only flagged
//      when the compiler does not know the parameter IS a format string.
// MSVC has no equivalent attribute; it uses SAL, which we do not need here.
#if defined(__GNUC__) || defined(__clang__)
#define FSMETA_PRINTF_FORMAT(fmt_index, args_index)                            \
  __attribute__((format(printf, fmt_index, args_index)))
#else
#define FSMETA_PRINTF_FORMAT(fmt_index, args_index)
#endif

inline void DebugLog(const char *format, ...) FSMETA_PRINTF_FORMAT(1, 2);

inline void DebugLog(const char *format, ...) {
  if (!enableDebugLogging.load(std::memory_order_relaxed)) {
    return;
  }

  constexpr size_t TIMESTAMP_SIZE = 32;
  constexpr size_t MESSAGE_SIZE = 1024;

  char timestamp[TIMESTAMP_SIZE];
  char message[MESSAGE_SIZE];

  // Get timestamp
  auto now = std::chrono::system_clock::now();
  auto time = std::chrono::system_clock::to_time_t(now);
  auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                now.time_since_epoch()) %
            1000;

  tm timeInfo;
#ifdef _WIN32
  localtime_s(&timeInfo, &time);
#else
  localtime_r(&time, &timeInfo);
#endif

  snprintf(timestamp, TIMESTAMP_SIZE, "[%02d:%02d:%02d.%03d]", timeInfo.tm_hour,
           timeInfo.tm_min, timeInfo.tm_sec, static_cast<int>(ms.count()));

  va_list args;
  va_start(args, format);
  vsnprintf(message, MESSAGE_SIZE, format, args);
  va_end(args);

  std::string prefix;
  {
    auto &state = GetPrefixState();
    std::lock_guard<std::mutex> lock(state.mutex);
    prefix = state.prefix;
  }

  fprintf(stderr, "%s %s %s\n", timestamp, prefix.c_str(), message);
}

} // namespace Debug
} // namespace FSMeta

#define DEBUG_LOG(...) FSMeta::Debug::DebugLog(__VA_ARGS__)
