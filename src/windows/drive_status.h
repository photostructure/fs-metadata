// src/windows/drive_status.h
#pragma once
#include "../common/debug_log.h"
#include "security_utils.h"
#include "windows_arch.h"
#include <chrono>
#include <future>
#include <memory>
#include <stdexcept>
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

    // Convert the UTF-8 path to wide chars and use the W API: the A variants
    // interpret bytes in the active ANSI code page, which mangles or rejects
    // Unicode paths coming from JS.
    std::wstring searchPath = SecurityUtils::SafeStringToWide(path);
    if (!searchPath.empty() && searchPath.back() != L'\\') {
      searchPath += L'\\';
    }
    searchPath += L'*';

    WIN32_FIND_DATAW findData;
    // Use FindHandleGuard - search handles MUST be closed with FindClose,
    // not CloseHandle. See:
    // https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-findclose
    FindHandleGuard findHandle(FindFirstFileExW(
        searchPath.c_str(), FindExInfoBasic, &findData, FindExSearchNameMatch,
        nullptr,
        FIND_FIRST_EX_LARGE_FETCH | FIND_FIRST_EX_ON_DISK_ENTRIES_ONLY));

    if (!findHandle) {
      DWORD error = GetLastError();
      DEBUG_LOG("[DriveStatusChecker] FindFirstFileEx failed for %s: %lu",
                path.c_str(), error);
      // A wildcard search on an empty root has no matching child and returns
      // ERROR_FILE_NOT_FOUND. The root itself is still accessible.
      if (error == ERROR_FILE_NOT_FOUND) {
        return DriveStatus::Healthy;
      }
      return MapErrorToDriveStatus(error);
    }

    // Successfully opened - drive is healthy
    // FindHandleGuard destructor will call FindClose automatically
    DEBUG_LOG("[DriveStatusChecker] Drive %s is healthy", path.c_str());
    return DriveStatus::Healthy;
  }

  struct DriveCheckTask {
    std::string path;
    std::shared_ptr<std::promise<DriveStatus>> promise;
    HMODULE module; // addon DLL reference released when the callback returns
  };

  static void CALLBACK DriveCheckCallback(PTP_CALLBACK_INSTANCE instance,
                                          PVOID context) noexcept {
    std::unique_ptr<DriveCheckTask> task(
        static_cast<DriveCheckTask *>(context));

    // Release, when this callback returns, the addon DLL reference taken in
    // CheckDriveAsync. A Node Worker that is the addon's last loader unloads
    // this DLL (uv_dlclose) on teardown; without the held reference a probe
    // still blocked in the pool would return into unmapped code and crash.
    // https://learn.microsoft.com/en-us/windows/win32/api/threadpoolapiset/nf-threadpoolapiset-freelibrarywhencallbackreturns
    FreeLibraryWhenCallbackReturns(instance, task->module);

    // These probes may block indefinitely in a filesystem/network provider.
    // Marking the callback as long-running lets the Windows pool provide
    // replacement capacity instead of pinning a fixed set of workers.
    if (!CallbackMayRunLong(instance)) {
      DEBUG_LOG("[DriveStatusChecker] Windows could not immediately provide "
                "replacement capacity for %s",
                task->path.c_str());
    }

    try {
      task->promise->set_value(CheckDriveInternal(task->path));
    } catch (const std::exception &e) {
      DEBUG_LOG("[DriveStatusChecker] Exception in CheckDriveInternal: %s",
                e.what());
      try {
        task->promise->set_exception(std::current_exception());
      } catch (...) {
        // The promise may already have been satisfied.
      }
    } catch (...) {
      DEBUG_LOG("[DriveStatusChecker] Unknown exception in "
                "CheckDriveInternal");
      try {
        task->promise->set_exception(std::current_exception());
      } catch (...) {
        // The promise may already have been satisfied.
      }
    }
  }

public:
  // Submit a drive check to the adaptive Windows callback pool and return a
  // future. The caller is responsible for enforcing timeout via wait_for().
  // A timed-out callback may remain blocked, but it no longer consumes one of
  // a fixed number of application-owned workers.
  static std::future<DriveStatus> CheckDriveAsync(const std::string &path) {
    auto promise = std::make_shared<std::promise<DriveStatus>>();
    auto future = promise->get_future();

    // Pin this addon DLL for the callback's lifetime. GetModuleHandleEx with
    // FROM_ADDRESS takes a reference (refcount++) that the callback releases via
    // FreeLibraryWhenCallbackReturns, so a Node Worker teardown cannot unmap
    // code the process thread pool is still running. Fail closed if the
    // reference cannot be taken rather than risk a use-after-unload.
    HMODULE module = nullptr;
    if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
                            reinterpret_cast<LPCWSTR>(&DriveCheckCallback),
                            &module)) {
      const DWORD error = GetLastError();
      promise->set_exception(std::make_exception_ptr(std::runtime_error(
          "GetModuleHandleEx failed with error " + std::to_string(error))));
      return future;
    }

    auto task =
        std::make_unique<DriveCheckTask>(DriveCheckTask{path, promise, module});
    if (!TrySubmitThreadpoolCallback(DriveCheckCallback, task.get(), nullptr)) {
      const DWORD error = GetLastError();
      FreeLibrary(module); // no callback will run to release the reference
      promise->set_exception(std::make_exception_ptr(
          std::runtime_error("TrySubmitThreadpoolCallback failed with error " +
                             std::to_string(error))));
      return future;
    }
    task.release(); // callback owns and deletes the task

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

      // timeoutMs 0 disables the timeout (see Options.timeoutMs).
      if (timeoutMs == 0) {
        return future.get();
      }

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
        // timeoutMs 0 disables the timeout (see Options.timeoutMs).
        if (timeoutMs == 0) {
          results.push_back(futures[i].get());
          continue;
        }

        // Calculate remaining time for this future
        auto elapsed = std::chrono::steady_clock::now() - startTime;
        auto elapsedMs =
            std::chrono::duration_cast<std::chrono::milliseconds>(elapsed)
                .count();
        auto remainingMs = (elapsedMs < static_cast<long long>(timeoutMs))
                               ? static_cast<DWORD>(timeoutMs - elapsedMs)
                               : 0;

        // Even with an exhausted budget (remainingMs == 0), wait_for() still
        // polls: all checks ran concurrently, so a future whose work finished
        // while an earlier drive consumed the budget must not be mislabeled
        // as Timeout.
        if (futures[i].wait_for(std::chrono::milliseconds(remainingMs)) ==
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
