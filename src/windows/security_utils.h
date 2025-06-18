// src/windows/security_utils.h
#pragma once
#include <algorithm>
#include <cctype>
#include <pathcch.h>
#include <sddl.h>
#include <stdexcept>
#include <string>
#include <strsafe.h>
#include <vector>
#include <windows.h>

#pragma comment(lib, "Pathcch.lib")

namespace FSMeta {

class SecurityUtils {
public:
  // Path validation to prevent security vulnerabilities
  static bool IsPathSecure(const std::string &path) {
    // Check for empty path
    if (path.empty()) {
      return false;
    }

    // Check for excessive length (prevent buffer overflow)
    if (path.length() > MAX_PATH) {
      return false;
    }

    // Check for null bytes
    if (path.find('\0') != std::string::npos) {
      return false;
    }

    // Check for directory traversal - be more strict
    // Check if path starts with ..
    if (path.size() >= 2 && path.substr(0, 2) == "..") {
      return false;
    }

    // Check for basic directory traversal
    if (path.find("..\\") != std::string::npos ||
        path.find("../") != std::string::npos ||
        path.find("\\..") != std::string::npos ||
        path.find("/..") != std::string::npos) {
      return false;
    }

    // Check for device names that could be exploited
    static const std::vector<std::string> deviceNames = {
        "CON",  "PRN",  "AUX",  "NUL",  "COM1", "COM2", "COM3", "COM4",
        "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3",
        "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"};

    std::string upperPath = path;
    std::transform(upperPath.begin(), upperPath.end(), upperPath.begin(),
                   ::toupper);

    for (const auto &device : deviceNames) {
      // Check for device name in path components
      if (upperPath.find("\\" + device) != std::string::npos ||
          upperPath.find("/" + device) != std::string::npos) {
        // Check if it's followed by a backslash, forward slash, dot, or end of
        // string
        size_t pos = upperPath.find("\\" + device);
        if (pos == std::string::npos) {
          pos = upperPath.find("/" + device);
        }
        if (pos != std::string::npos) {
          size_t endPos = pos + 1 + device.length();
          if (endPos >= upperPath.length() || upperPath[endPos] == '\\' ||
              upperPath[endPos] == '/' || upperPath[endPos] == '.') {
            return false;
          }
        }
      }
    }

    // Check for alternate data streams (except drive letter colon)
    size_t colonPos = path.find(':');
    if (colonPos != std::string::npos) {
      // Allow only if it's a drive letter at position 1
      if (!(colonPos == 1 && isalpha(path[0]) &&
            (path.length() == 2 || path[2] == '\\' || path[2] == '/'))) {
        return false; // Alternate data stream attempt
      }
      // Check for multiple colons
      if (path.find(':', colonPos + 1) != std::string::npos) {
        return false;
      }
    }

    // Check for UNC path injection
    if (path.size() >= 4) {
      if ((path.substr(0, 4) == "\\\\?\\") ||
          (path.substr(0, 4) == "\\\\.\\")) {
        return false; // Device namespace paths are dangerous
      }
    }

    return true;
  }

  // Safe path normalization
  static std::wstring NormalizePath(const std::wstring &path) {
    // Use PathCchCanonicalize for safe canonicalization
    wchar_t canonicalPath[MAX_PATH];
    HRESULT hr = PathCchCanonicalize(canonicalPath, MAX_PATH, path.c_str());

    if (FAILED(hr)) {
      throw std::runtime_error("Failed to canonicalize path");
    }

    return std::wstring(canonicalPath);
  }

  // Check if process has required privileges
  static bool HasRequiredPrivileges() {
    HANDLE token;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
      return false;
    }

    TOKEN_ELEVATION elevation;
    DWORD size = sizeof(elevation);
    BOOL result = GetTokenInformation(token, TokenElevation, &elevation,
                                      sizeof(elevation), &size);

    CloseHandle(token);
    return result && elevation.TokenIsElevated;
  }

  // Safe string conversion with validation
  static std::wstring SafeStringToWide(const std::string &str,
                                       size_t maxLength = MAX_PATH) {
    if (str.empty()) {
      return L"";
    }

    if (str.length() > maxLength) {
      throw std::invalid_argument("String exceeds maximum allowed length");
    }

    // Validate UTF-8 sequence before conversion
    int requiredSize = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                           str.c_str(), -1, nullptr, 0);

    if (requiredSize == 0) {
      throw std::runtime_error("Invalid UTF-8 sequence");
    }

    std::wstring result(requiredSize - 1, L'\0');
    if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, str.c_str(), -1,
                             &result[0], requiredSize)) {
      throw std::runtime_error("Failed to convert string");
    }

    return result;
  }
};

// RAII wrapper for HANDLE resources
class HandleGuard {
  HANDLE handle;

public:
  explicit HandleGuard(HANDLE h) : handle(h) {}

  ~HandleGuard() {
    if (handle && handle != INVALID_HANDLE_VALUE) {
      CloseHandle(handle);
    }
  }

  HandleGuard(HandleGuard &&other) noexcept : handle(other.handle) {
    other.handle = nullptr;
  }

  HandleGuard &operator=(HandleGuard &&other) noexcept {
    if (this != &other) {
      if (handle && handle != INVALID_HANDLE_VALUE) {
        CloseHandle(handle);
      }
      handle = other.handle;
      other.handle = nullptr;
    }
    return *this;
  }

  // Delete copy operations
  HandleGuard(const HandleGuard &) = delete;
  HandleGuard &operator=(const HandleGuard &) = delete;

  HANDLE get() const { return handle; }
  HANDLE release() {
    HANDLE h = handle;
    handle = nullptr;
    return h;
  }

  explicit operator bool() const {
    return handle && handle != INVALID_HANDLE_VALUE;
  }
};

// RAII wrapper for critical sections
class CriticalSectionGuard {
  CRITICAL_SECTION cs;

public:
  CriticalSectionGuard() { InitializeCriticalSection(&cs); }

  ~CriticalSectionGuard() { DeleteCriticalSection(&cs); }

  // Delete copy/move operations
  CriticalSectionGuard(const CriticalSectionGuard &) = delete;
  CriticalSectionGuard &operator=(const CriticalSectionGuard &) = delete;
  CriticalSectionGuard(CriticalSectionGuard &&) = delete;
  CriticalSectionGuard &operator=(CriticalSectionGuard &&) = delete;

  void Enter() { EnterCriticalSection(&cs); }
  void Leave() { LeaveCriticalSection(&cs); }
  BOOL TryEnter() { return TryEnterCriticalSection(&cs); }

  // RAII lock helper
  class Lock {
    CriticalSectionGuard &guard;

  public:
    explicit Lock(CriticalSectionGuard &g) : guard(g) { guard.Enter(); }

    ~Lock() { guard.Leave(); }

    // Delete copy/move
    Lock(const Lock &) = delete;
    Lock &operator=(const Lock &) = delete;
  };
};

} // namespace FSMeta