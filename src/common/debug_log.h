// src/common/debug_log.h
#pragma once
#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <string>
#include <string_view>

namespace FSMeta {
namespace Debug {

inline bool enableDebugLogging = false;
inline std::string debugPrefix;

#ifdef _WIN32
inline std::wstring wDebugPrefix;
inline void SetDebugPrefix(const std::string &prefix) {
  debugPrefix = prefix;
  wDebugPrefix = std::wstring(prefix.begin(), prefix.end());
}
#else
inline void SetDebugPrefix(const std::string &prefix) { debugPrefix = prefix; }
#endif

inline void DebugLog(const char *format, ...) {
  if (!enableDebugLogging) {
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

  fprintf(stderr, "%s %s %s\n", timestamp, debugPrefix.c_str(), message);
}

} // namespace Debug
} // namespace FSMeta

#define DEBUG_LOG(...) FSMeta::Debug::DebugLog(__VA_ARGS__)