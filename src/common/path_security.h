// src/common/path_security.h
// Secure path validation using POSIX realpath()
// Based on recommendations from Apple's Secure Coding Guide and CERT C
// guidelines References:
// -
// https://developer.apple.com/library/archive/documentation/Security/Conceptual/SecureCodingGuide/Articles/RaceConditions.html
// - https://wiki.sei.cmu.edu/confluence/x/DtcxBQ (FIO02-C)

#pragma once

#include "debug_log.h"
#include "error_utils.h"
#include <cerrno>
#include <cstring>
#include <string>
#include <sys/param.h> // For PATH_MAX
#include <unistd.h>    // For realpath()

namespace FSMeta {

/**
 * Validates a path for security issues and canonicalizes it using realpath().
 *
 * This function prevents directory traversal attacks by:
 * 1. Checking for null bytes (path injection)
 * 2. Using realpath() to resolve symbolic links and path references (../, ./)
 * 3. Handling non-existent paths by validating the parent directory
 *
 * @param path The path to validate
 * @param error Output parameter for error message if validation fails
 * @param allow_nonexistent If true, allows paths that don't exist by validating
 * parent
 * @return The canonicalized path, or empty string if validation fails
 */
inline std::string ValidateAndCanonicalizePath(const std::string &path,
                                               std::string &error,
                                               bool allow_nonexistent = false) {
  DEBUG_LOG("[ValidateAndCanonicalizePath] Validating path: %s "
            "(allow_nonexistent: %d)",
            path.c_str(), allow_nonexistent);

  // Check for empty path
  if (path.empty()) {
    error = "Empty path provided";
    DEBUG_LOG("[ValidateAndCanonicalizePath] %s", error.c_str());
    return "";
  }

  // Security check #1: Reject paths with null bytes (path injection attack)
  if (path.find('\0') != std::string::npos) {
    error = "Invalid path containing null byte";
    DEBUG_LOG("[ValidateAndCanonicalizePath] %s", error.c_str());
    return "";
  }

  // Security check #2: Use realpath() to canonicalize and validate
  // realpath() resolves symbolic links and eliminates ../, ./, redundant
  // slashes
  char resolved_path[PATH_MAX];
  if (realpath(path.c_str(), resolved_path) != nullptr) {
    // Path exists and was successfully canonicalized
    std::string canonical_path(resolved_path);
    DEBUG_LOG("[ValidateAndCanonicalizePath] Canonicalized: %s -> %s",
              path.c_str(), canonical_path.c_str());
    return canonical_path;
  }

  // realpath() failed - check if it's because the path doesn't exist
  int realpath_error = errno;

  if (realpath_error == ENOENT && allow_nonexistent) {
    // For operations that create files (like setHidden), validate parent
    // directory
    DEBUG_LOG(
        "[ValidateAndCanonicalizePath] Path doesn't exist, validating parent");

    // Find the parent directory
    size_t last_slash = path.find_last_of('/');
    std::string parent_dir;

    if (last_slash == std::string::npos) {
      // No slash found - relative path, use current directory
      parent_dir = ".";
    } else if (last_slash == 0) {
      // Root directory
      parent_dir = "/";
    } else {
      parent_dir = path.substr(0, last_slash);
    }

    // Validate parent directory exists and is accessible
    if (realpath(parent_dir.c_str(), resolved_path) == nullptr) {
      int parent_error = errno;
      error =
          CreatePathErrorMessage("realpath (parent)", parent_dir, parent_error);
      DEBUG_LOG("[ValidateAndCanonicalizePath] Parent validation failed: %s",
                error.c_str());
      return "";
    }

    // Parent is valid - construct the full path
    std::string parent_canonical(resolved_path);
    std::string filename =
        (last_slash == std::string::npos) ? path : path.substr(last_slash + 1);

    std::string result;
    if (parent_canonical == "/") {
      result = "/" + filename;
    } else {
      result = parent_canonical + "/" + filename;
    }

    DEBUG_LOG(
        "[ValidateAndCanonicalizePath] Validated non-existent path: %s -> %s",
        path.c_str(), result.c_str());
    return result;
  }

  // realpath() failed for a different reason, or path doesn't exist and we
  // don't allow it
  error = CreatePathErrorMessage("realpath", path, realpath_error);
  DEBUG_LOG("[ValidateAndCanonicalizePath] Failed: %s", error.c_str());
  return "";
}

/**
 * Validates that a path is secure for read operations.
 * The path must exist and be accessible.
 *
 * @param path The path to validate
 * @param error Output parameter for error message if validation fails
 * @return The canonicalized path, or empty string if validation fails
 */
inline std::string ValidatePathForRead(const std::string &path,
                                       std::string &error) {
  return ValidateAndCanonicalizePath(path, error, false);
}

/**
 * Validates that a path is secure for write operations.
 * The path may not exist, but its parent directory must be valid.
 *
 * @param path The path to validate
 * @param error Output parameter for error message if validation fails
 * @return The canonicalized path, or empty string if validation fails
 */
inline std::string ValidatePathForWrite(const std::string &path,
                                        std::string &error) {
  return ValidateAndCanonicalizePath(path, error, true);
}

} // namespace FSMeta
