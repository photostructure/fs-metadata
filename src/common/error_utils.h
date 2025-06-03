// src/common/error_utils.h
#pragma once
#include <cstring>
#include <stdexcept>
#include <string>

namespace FSMeta {

class FSException : public std::runtime_error {
public:
  explicit FSException(const std::string &message)
      : std::runtime_error(message) {}
};

// Simple error code only version
inline std::string CreateErrorMessage(const char *operation, int error) {
  return std::string(operation) +
         " failed with error: " + std::to_string(error);
}

// Human-readable error with code (used by most callers)
inline std::string CreateErrorMessageWithStrerror(const char *operation,
                                                  int error) {
  return std::string(strerror(error)) + " (" + std::to_string(error) + ")";
}

// Convenience function for common pattern: "operation failed for 'path': error"
inline std::string CreatePathErrorMessage(const char *operation,
                                          const std::string &path, int error) {
  return std::string(operation) + " failed for '" + path +
         "': " + std::string(strerror(error)) + " (" + std::to_string(error) +
         ")";
}

// For operations without a path context
inline std::string CreateDetailedErrorMessage(const char *operation,
                                              int error) {
  return std::string(operation) + " failed: " + std::string(strerror(error)) +
         " (" + std::to_string(error) + ")";
}

} // namespace FSMeta
