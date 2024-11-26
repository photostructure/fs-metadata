// src/windows/error_utils.h
#pragma once
#include <sstream>
#include <stdexcept>
#include <string>
#include <windows.h>

namespace FSMeta {

class FSException : public std::runtime_error {
public:
  explicit FSException(const std::string &message)
      : std::runtime_error(message) {}

  FSException(const std::string &operation, DWORD errorCode)
      : std::runtime_error(FormatWindowsError(operation, errorCode)) {}

private:
  static std::string FormatWindowsError(const std::string &operation,
                                        DWORD error) {
    if (error == 0) {
      return operation + " failed with an unknown error";
    }

    LPVOID messageBuffer;
    size_t size = FormatMessageA(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
            FORMAT_MESSAGE_IGNORE_INSERTS,
        NULL, error, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
        (LPSTR)&messageBuffer, 0, NULL);

    if (size == 0 || !messageBuffer) {
      return operation + " failed with error code: " + std::to_string(error);
    }

    std::string errorMessage((LPSTR)messageBuffer, size);
    LocalFree(messageBuffer);

    return operation + " failed: " + errorMessage;
  }
};

} // namespace FSMeta
