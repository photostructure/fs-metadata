// src/windows/drive_status.h
#pragma once
#include "../common/debug_log.h"
#include "security_utils.h"
#include "thread_pool.h"
#include "windows_arch.h"
#include <chrono>
#include <future>
#include <string>
#include <vector>

namespace FSMeta {

enum class DriveStatus {
  Healthy,
  Timeout,
  Inaccessible,
  Disconnected,
  Unknown
};

inline std::string DriveStatusToString(DriveStatus status) {
  switch (status) {
  case DriveStatus::Healthy:
    return "healthy";
  case DriveStatus::Timeout:
    return "timeout";
  case DriveStatus::Inaccessible:
    return "inaccessible";
  case DriveStatus::Disconnected:
    return "disconnected";
  default:
    return "unknown";
  }
}

class DriveStatusChecker {
private:
  static DriveStatus MapErrorToDriveStatus(DWORD error) {
    switch (error) {
    case ERROR_SUCCESS:
      return DriveStatus::Healthy;

    case ERROR_FILE_NOT_FOUND:
    case ERROR_PATH_NOT_FOUND:
    case ERROR_ACCESS_DENIED:
    case ERROR_LOGON_FAILURE:
    case ERROR_SHARING_VIOLATION:
      return DriveStatus::Inaccessible;

    case ERROR_BAD_NET_NAME:
    case ERROR_NETWORK_UNREACHABLE:
    case ERROR_NOT_CONNECTED:
    case ERROR_NETWORK_ACCESS_DENIED:
    case ERROR_BAD_NETPATH:
    case ERROR_NO_NET_OR_BAD_PATH:
      return DriveStatus::Disconnected;

    default:
      return DriveStatus::Unknown;
    }
  }

  static DriveStatus CheckDriveInternal(const std::string &path) {
    DEBUG_LOG("[DriveStatusChecker] Checking drive: %s", path.c_str());

    // Validate path
    if (!SecurityUtils::IsPathSecure(path)) {
      DEBUG_LOG("[DriveStatusChecker] Path failed security check: %s",
                path.c_str());
      return DriveStatus::Inaccessible;
    }

    // Ensure path ends with backslash for FindFirstFileEx
    std::string searchPath = path;
    if (!searchPath.empty() && searchPath.back() != '\\') {
      searchPath += '\\';
    }
    searchPath += "*";

    WIN32_FIND_DATAA findData;
    // Use FindHandleGuard - search handles MUST be closed with FindClose,
    // not CloseHandle. See:
    // https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-findclose
    FindHandleGuard findHandle(FindFirstFileExA(
        searchPath.c_str(), FindExInfoBasic, &findData, FindExSearchNameMatch,
        nullptr,
        FIND_FIRST_EX_LARGE_FETCH | FIND_FIRST_EX_ON_DISK_ENTRIES_ONLY));

    if (!findHandle) {
      DWORD error = GetLastError();
      DEBUG_LOG("[DriveStatusChecker] FindFirstFileEx failed for %s: %lu",
                path.c_str(), error);
      return MapErrorToDriveStatus(error);
    }

    // Successfully opened - drive is healthy
    // FindHandleGuard destructor will call FindClose automatically
    DEBUG_LOG("[DriveStatusChecker] Drive %s is healthy", path.c_str());
    return DriveStatus::Healthy;
  }

public:
  // Submit a drive check to the thread pool and return a future.
  // The caller is responsible for enforcing timeout via future.wait_for().
  // This design avoids detached threads and race conditions.
  static std::future<DriveStatus> CheckDriveAsync(const std::string &path) {
    auto promise = std::make_shared<std::promise<DriveStatus>>();
    auto future = promise->get_future();

    GetGlobalThreadPool().Submit([path, promise]() {
      try {
        DriveStatus status = CheckDriveInternal(path);
        promise->set_value(status);
      } catch (const std::exception &e) {
        DEBUG_LOG("[DriveStatusChecker] Exception in CheckDriveInternal: %s",
                  e.what());
        // Set exception instead of value so caller can handle it
        try {
          promise->set_exception(std::current_exception());
        } catch (...) {
          // Promise may have been abandoned if caller timed out
        }
      } catch (...) {
        DEBUG_LOG(
            "[DriveStatusChecker] Unknown exception in CheckDriveInternal");
        try {
          promise->set_exception(std::current_exception());
        } catch (...) {
          // Promise may have been abandoned if caller timed out
        }
      }
    });

    return future;
  }

  // Overload that accepts timeoutMs for API compatibility (timeout is enforced
  // in CheckDrive, not here)
  static std::future<DriveStatus> CheckDriveAsync(const std::string &path,
                                                  DWORD /*timeoutMs*/) {
    return CheckDriveAsync(path);
  }

  static DriveStatus CheckDrive(const std::string &path,
                                DWORD timeoutMs = 5000) {
    try {
      auto future = CheckDriveAsync(path);

      // Use wait_for to enforce timeout - no detached threads needed!
      // The worker thread continues running but we return Timeout to caller.
      // The promise will eventually be satisfied (or abandoned).
      auto waitResult = future.wait_for(std::chrono::milliseconds(timeoutMs));

      if (waitResult == std::future_status::timeout) {
        DEBUG_LOG("[DriveStatusChecker] Timeout waiting for drive %s",
                  path.c_str());
        return DriveStatus::Timeout;
      }

      // Future is ready - get the result (may throw if worker set exception)
      return future.get();
    } catch (const std::exception &e) {
      DEBUG_LOG("[DriveStatusChecker] Exception checking drive %s: %s",
                path.c_str(), e.what());
      return DriveStatus::Unknown;
    } catch (...) {
      DEBUG_LOG("[DriveStatusChecker] Unknown exception checking drive %s",
                path.c_str());
      return DriveStatus::Unknown;
    }
  }

  static std::vector<DriveStatus>
  CheckMultipleDrives(const std::vector<std::string> &paths,
                      DWORD timeoutMs = 5000) {

    std::vector<std::future<DriveStatus>> futures;
    futures.reserve(paths.size());

    // Launch all checks concurrently
    auto startTime = std::chrono::steady_clock::now();
    for (const auto &path : paths) {
      futures.push_back(CheckDriveAsync(path));
    }

    // Collect results with timeout
    std::vector<DriveStatus> results;
    results.reserve(paths.size());

    for (size_t i = 0; i < futures.size(); ++i) {
      try {
        // Calculate remaining time for this future
        auto elapsed = std::chrono::steady_clock::now() - startTime;
        auto elapsedMs =
            std::chrono::duration_cast<std::chrono::milliseconds>(elapsed)
                .count();
        auto remainingMs = (elapsedMs < static_cast<long long>(timeoutMs))
                               ? static_cast<DWORD>(timeoutMs - elapsedMs)
                               : 0;

        if (remainingMs == 0 ||
            futures[i].wait_for(std::chrono::milliseconds(remainingMs)) ==
                std::future_status::timeout) {
          DEBUG_LOG("[DriveStatusChecker] Timeout waiting for drive %s",
                    paths[i].c_str());
          results.push_back(DriveStatus::Timeout);
        } else {
          results.push_back(futures[i].get());
        }
      } catch (const std::exception &e) {
        DEBUG_LOG(
            "[DriveStatusChecker] Exception getting result for drive %s: %s",
            paths[i].c_str(), e.what());
        results.push_back(DriveStatus::Unknown);
      } catch (...) {
        DEBUG_LOG("[DriveStatusChecker] Unknown exception for drive %s",
                  paths[i].c_str());
        results.push_back(DriveStatus::Unknown);
      }
    }

    return results;
  }
};

// Compatibility wrapper for existing code
inline std::vector<DriveStatus>
CheckDriveStatus(const std::vector<std::string> &paths,
                 DWORD timeoutMs = 5000) {
  return DriveStatusChecker::CheckMultipleDrives(paths, timeoutMs);
}

inline DriveStatus CheckDriveStatus(const std::string &path,
                                    DWORD timeoutMs = 5000) {
  return DriveStatusChecker::CheckDrive(path, timeoutMs);
}

} // namespace FSMeta