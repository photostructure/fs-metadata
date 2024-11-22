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
};

inline std::string CreateErrorMessage(const char *operation, DWORD error) {
  std::ostringstream oss;
  oss << operation << " failed with error: " << error;
  return oss.str();
}

} // namespace FSMeta
