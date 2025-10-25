// src/windows/string.h

#pragma once
#include "../common/debug_log.h"
#include "windows_arch.h"
#include <climits>
#include <pathcch.h>
#include <stdexcept>
#include <string>

namespace FSMeta {

// Maximum reasonable size for string conversions (1MB)
// Prevents allocation of excessive memory due to overflow or malicious input
constexpr int MAX_STRING_CONVERSION_SIZE = 1024 * 1024;

inline std::string WideToUtf8(const WCHAR *wide) {
  if (!wide || wide[0] == 0)
    return "";

  // Get required buffer size
  int size =
      WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);

  // Validate size is reasonable
  if (size <= 0) {
    DEBUG_LOG("[WideToUtf8] WideCharToMultiByte returned invalid size: %d",
              size);
    return "";
  }

  // Check for overflow: size - 1 should be positive and reasonable
  // INT_MAX - 1 check prevents overflow in subtraction
  // MAX_STRING_CONVERSION_SIZE check prevents excessive allocations
  if (size > INT_MAX - 1 || size > MAX_STRING_CONVERSION_SIZE) {
    DEBUG_LOG("[WideToUtf8] Size too large: %d (max: %d)", size,
              MAX_STRING_CONVERSION_SIZE);
    throw std::runtime_error(
        "String conversion size exceeds reasonable limits");
  }

  std::string result(static_cast<size_t>(size - 1), 0);

  // Perform conversion and check result
  int written = WideCharToMultiByte(CP_UTF8, 0, wide, -1, &result[0], size,
                                    nullptr, nullptr);
  if (written <= 0) {
    DEBUG_LOG("[WideToUtf8] WideCharToMultiByte conversion failed: %lu",
              GetLastError());
    throw std::runtime_error("String conversion failed");
  }

  return result;
}

class PathConverter {
public:
  static std::wstring ToWString(const std::string &path) {
    if (path.empty()) {
      return L"";
    }

    // Validate input length fits in int (required by MultiByteToWideChar)
    if (path.length() > static_cast<size_t>(INT_MAX)) {
      DEBUG_LOG("[ToWString] Input path length exceeds INT_MAX: %zu",
                path.length());
      throw std::runtime_error("Input string too large for conversion");
    }

    int wlen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path.c_str(),
                                   static_cast<int>(path.length()), nullptr, 0);

    // Validate wlen
    if (wlen <= 0) {
      DEBUG_LOG(
          "[ToWString] MultiByteToWideChar returned invalid size: %d (error: "
          "%lu)",
          wlen, GetLastError());
      return L"";
    }

    // Check for reasonable size (PATHCCH_MAX_CCH for paths)
    if (wlen > PATHCCH_MAX_CCH) {
      DEBUG_LOG("[ToWString] Size exceeds maximum path length: %d (max: %d)",
                wlen, PATHCCH_MAX_CCH);
      throw std::runtime_error("Path too long for conversion");
    }

    std::wstring wpath(static_cast<size_t>(wlen), 0);

    // Perform conversion with error checking
    int written =
        MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path.c_str(),
                            static_cast<int>(path.length()), &wpath[0], wlen);
    if (written <= 0) {
      DEBUG_LOG("[ToWString] MultiByteToWideChar conversion failed: %lu",
                GetLastError());
      throw std::runtime_error("String conversion failed");
    }

    return wpath;
  }
};

} // namespace FSMeta