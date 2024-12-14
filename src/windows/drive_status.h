// src/windows/drive_status.h

#pragma once
#include "../common/debug_log.h"
#include <memory>
#include <string>
#include <vector>
#include <windows.h>

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

class IOOperation {
private:
  HANDLE completionEvent;
  DriveStatus result;
  std::string path;
  DWORD threadId;
  volatile bool shouldTerminate;
  HANDLE threadHandle; // Store thread handle as member

public:
  IOOperation()
      : result(DriveStatus::Unknown), threadId(0), shouldTerminate(false),
        threadHandle(NULL) {
    completionEvent = CreateEvent(NULL, TRUE, FALSE, NULL);
  }

  ~IOOperation() {
    if (completionEvent) {
      CloseHandle(completionEvent);
    }
    CleanupThread();
  }

  void CleanupThread() {
    if (threadHandle) {
      DEBUG_LOG("[IOOperation] Cleaning up thread %lu", threadId);
      // Signal termination
      shouldTerminate = true;

      // Give thread chance to exit gracefully
      if (WaitForSingleObject(threadHandle, 100) != WAIT_OBJECT_0) {
        DEBUG_LOG("[IOOperation] Force terminating thread %lu", threadId);
        TerminateThread(threadHandle, 1);
      }

      CloseHandle(threadHandle);
      threadHandle = NULL;
      DEBUG_LOG("[IOOperation] Thread cleanup complete");
    }
  }

  static DWORD WINAPI WorkerThread(LPVOID param) {
    IOOperation *self = static_cast<IOOperation *>(param);
    std::string searchPath = self->path + "*";
    HANDLE findHandle = INVALID_HANDLE_VALUE;
    WIN32_FIND_DATAA findData;

    DEBUG_LOG("[WorkerThread] Starting search on path: %s", searchPath.c_str());

    findHandle = FindFirstFileExA(
        searchPath.c_str(), FindExInfoBasic, &findData, FindExSearchNameMatch,
        NULL, FIND_FIRST_EX_LARGE_FETCH | FIND_FIRST_EX_ON_DISK_ENTRIES_ONLY);

    if (findHandle == INVALID_HANDLE_VALUE) {
      self->result = self->MapErrorToDriveStatus(GetLastError());
      DEBUG_LOG("[WorkerThread] Search failed with error: %lu", GetLastError());
    } else {
      self->result = DriveStatus::Healthy;
      FindClose(findHandle);
      DEBUG_LOG("[WorkerThread] Search completed successfully");
    }

    SetEvent(self->completionEvent);
    DEBUG_LOG("[WorkerThread] Thread %lu exiting", self->threadId);
    return 0;
  }

  DriveStatus CheckDriveWithTimeout(const std::string &checkPath,
                                    DWORD timeoutMs) {
    DEBUG_LOG("[CheckDriveStatus] Starting check for: %s timeout: %lu ms",
              checkPath.c_str(), timeoutMs);

    // Cleanup any previous thread
    CleanupThread();

    path = checkPath;
    ResetEvent(completionEvent);
    shouldTerminate = false;

    threadHandle = CreateThread(NULL, 0, WorkerThread, this, 0, &threadId);
    if (!threadHandle) {
      DEBUG_LOG("[CheckDriveStatus] Failed to create thread");
      return DriveStatus::Unknown;
    }

    DEBUG_LOG("[CheckDriveStatus] Created thread %lu", threadId);
    DWORD waitResult = WaitForSingleObject(threadHandle, timeoutMs);

    if (waitResult == WAIT_TIMEOUT) {
      DEBUG_LOG("[CheckDriveStatus] Thread %lu timed out after %lu ms",
                threadId, timeoutMs);
      CleanupThread();
      return DriveStatus::Timeout;
    }

    DEBUG_LOG("[CheckDriveStatus] Thread %lu completed normally", threadId);
    CloseHandle(threadHandle);
    DEBUG_LOG("[CheckDriveStatus] CloseHandle %lu completed", threadId);
    threadHandle = NULL;
    return result;
  }

private:
  DriveStatus MapErrorToDriveStatus(DWORD error) {
    switch (error) {
    case ERROR_FILE_NOT_FOUND:
    case ERROR_PATH_NOT_FOUND:
    case ERROR_ACCESS_DENIED:
    case ERROR_LOGON_FAILURE:
      return DriveStatus::Inaccessible;

    case ERROR_BAD_NET_NAME:
    case ERROR_NETWORK_UNREACHABLE:
    case ERROR_NOT_CONNECTED:
    case ERROR_NETWORK_ACCESS_DENIED:
    case ERROR_BAD_NETPATH:
      return DriveStatus::Disconnected;

    default:
      return DriveStatus::Unknown;
    }
  }
};

class ParallelDriveStatus {
private:
  struct PendingCheck {
    std::string path;
    std::unique_ptr<IOOperation> op;
    DWORD timeoutMs;
    DriveStatus status;
  };

  std::vector<std::unique_ptr<PendingCheck>> pending_;

public:
  void Submit(const std::string &path, DWORD timeoutMs = 1000) {
    auto check = std::make_unique<PendingCheck>();
    check->path = path;
    check->op = std::make_unique<IOOperation>();
    check->timeoutMs = timeoutMs;
    check->status = DriveStatus::Unknown;

    DEBUG_LOG("[ParallelDriveStatus] Submitting check for: %s", path.c_str());
    pending_.push_back(std::move(check));
  }

  std::vector<DriveStatus> WaitForResults() {
    std::vector<DriveStatus> results;
    results.reserve(pending_.size());

    // Start all operations
    for (auto &check : pending_) {
      check->status =
          check->op->CheckDriveWithTimeout(check->path, check->timeoutMs);
    }

    // Collect results in original order
    for (auto &check : pending_) {
      DEBUG_LOG("[ParallelDriveStatus] Result for %s: %s", check->path.c_str(),
                DriveStatusToString(check->status).c_str());
      results.push_back(check->status);
    }

    pending_.clear();
    return results;
  }
};

// Update CheckDriveStatus to support checking multiple paths
inline std::vector<DriveStatus>
CheckDriveStatus(const std::vector<std::string> &paths,
                 DWORD timeoutMs = 1000) {
  try {
    ParallelDriveStatus checker;
    for (const auto &path : paths) {
      checker.Submit(path, timeoutMs);
    }
    return checker.WaitForResults();
  } catch (...) {
    DEBUG_LOG("[CheckDriveStatus] caught unexpected exception");
    return std::vector<DriveStatus>(paths.size(), DriveStatus::Unknown);
  }
}

// Keep single path version for backwards compatibility
inline DriveStatus CheckDriveStatus(const std::string &path,
                                    DWORD timeoutMs = 1000) {
  std::vector<std::string> paths{path};
  return CheckDriveStatus(paths, timeoutMs)[0];
}

} // namespace FSMeta