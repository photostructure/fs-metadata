// src/common/error_utils.h
#pragma once
#include <stdexcept>
#include <string>

namespace FSMeta {

class FSException : public std::runtime_error {
public:
  explicit FSException(const std::string &message)
      : std::runtime_error(message) {}
};

inline std::string CreateErrorMessage(const char *operation, int error) {
  return std::string(operation) +
         " failed with error: " + std::to_string(error);
}

} // namespace FSMeta