// src/windows/error_utils.h
#pragma once
#include "../common/debug_log.h"
#include "windows_arch.h"
#include <sstream>
#include <stdexcept>
#include <string>

namespace FSMeta {

class FSException : public std::runtime_error {
public:
  explicit FSException(const std::string &message)
      : std::runtime_error(message) {}

  FSException(const std::string &operation, DWORD errorCode)
      : std::runtime_error(FormatWindowsError(operation, errorCode)) {}

private:
  // RAII wrapper for LocalFree - ensures cleanup even if exception thrown
  // Prevents memory leaks when FormatMessageA allocates a buffer
  struct LocalFreeGuard {
    LPVOID ptr;

    explicit LocalFreeGuard(LPVOID p) : ptr(p) {}

    ~LocalFreeGuard() {
      if (ptr) {
        LocalFree(ptr);
        DEBUG_LOG("[LocalFreeGuard] LocalFree called on FormatMessage buffer");
      }
    }

    // Prevent copying to ensure single ownership
    LocalFreeGuard(const LocalFreeGuard &) = delete;
    LocalFreeGuard &operator=(const LocalFreeGuard &) = delete;

    // Allow moving for flexibility
    LocalFreeGuard(LocalFreeGuard &&other) noexcept : ptr(other.ptr) {
      other.ptr = nullptr;
    }

    LocalFreeGuard &operator=(LocalFreeGuard &&other) noexcept {
      if (this != &other) {
        if (ptr) {
          LocalFree(ptr);
        }
        ptr = other.ptr;
        other.ptr = nullptr;
      }
      return *this;
    }
  };

  static std::string FormatWindowsError(const std::string &operation,
                                        DWORD error) {
    if (error == 0) {
      return operation + " failed with an unknown error";
    }

    LPVOID messageBuffer = nullptr;
    size_t size = FormatMessageA(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
            FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr, error, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
        (LPSTR)&messageBuffer, 0, nullptr);

    // RAII guard ensures LocalFree is called even if exception thrown
    LocalFreeGuard guard(messageBuffer);

    if (size == 0 || !messageBuffer) {
      DWORD formatError = GetLastError();
      DEBUG_LOG("[FormatWindowsError] FormatMessageA failed for error %lu: "
                "FormatMessage error=%lu, size=%zu",
                error, formatError, size);
      return operation + " failed with error code: " + std::to_string(error);
    }

    // Now safe: guard will free messageBuffer even if string construction
    // throws
    std::string errorMessage((LPSTR)messageBuffer, size);

    // Trim trailing newlines/carriage returns that Windows adds
    while (!errorMessage.empty() &&
           (errorMessage.back() == '\r' || errorMessage.back() == '\n')) {
      errorMessage.pop_back();
    }

    return operation + " failed: " + errorMessage;
    // guard destructor automatically calls LocalFree here
  }
};

} // namespace FSMeta
