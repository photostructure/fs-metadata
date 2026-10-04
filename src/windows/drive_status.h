// src/windows/drive_status.h
#pragma once
#include "../common/debug_log.h"
#include "security_utils.h"
#include "string.h"
#include "windows_arch.h"
#include <chrono>
#include <future>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
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

// What GetVolumeInformationW reports for a drive. Read inside the timed
// per-drive callback, so enumeration cannot block on it: measured on a drive
// letter pointing at an unroutable UNC path, that one call took 21,047 ms to
// return ERROR_BAD_NETPATH.
struct DriveVolumeInfo {
  bool valid = false;
  std::string fstype;
  bool isReadOnly = false;
};

// Everything one timed drive check produces. A `Healthy` status always means
// the volume query answered: either with valid data, or with an invalid
// `volumeInfo` because GetVolumeInformationW returned FALSE. A query that
// never answered reports Timeout instead, so no caller sees a healthy drive
// whose `isReadOnly` is a default nobody read.
struct DriveCheckResult {
  DriveStatus status = DriveStatus::Unknown;
  DriveVolumeInfo volumeInfo;
};

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

  // GetVolumeInformationW, run inside the timed callback. Only the filesystem
  // type and the read-only flag are read here; the metadata path needs the
  // label, serial number and free space too, and asks for all of them
  // together (src/windows/volume_metadata.cpp).
  static DriveVolumeInfo ReadVolumeInformation(const std::string &path) {
    DriveVolumeInfo info;
    const std::wstring widePath = SecurityUtils::SafeStringToWide(path);

    DWORD fsFlags = 0;
    WCHAR fsName[MAX_PATH + 1] = {0};
    if (GetVolumeInformationW(widePath.c_str(), nullptr, 0, nullptr, nullptr,
                              &fsFlags, fsName, MAX_PATH)) {
      info.valid = true;
      info.fstype = WideToUtf8(fsName);
      info.isReadOnly = (fsFlags & FILE_READ_ONLY_VOLUME) != 0;
      DEBUG_LOG("[DriveStatusChecker] Drive %s filesystem: %s", path.c_str(),
                info.fstype.c_str());
    } else {
      DEBUG_LOG("[DriveStatusChecker] GetVolumeInformation failed for %s: %lu",
                path.c_str(), GetLastError());
    }
    return info;
  }

  // One running check, shared by every caller that asks for this path while
  // it is in flight. `status` settles when the directory probe returns;
  // `volumeInfo` settles after the volume query, so a caller that needs only
  // the status never waits for the query.
  struct InflightCheck {
    std::shared_future<DriveStatus> status;
    std::shared_future<DriveVolumeInfo> volumeInfo;
  };

  struct CheckRegistry {
    std::mutex mutex;
    std::unordered_map<std::string, InflightCheck> inflight;
  };

  // A timed-out callback is abandoned, not cancelled: Windows cancellation is
  // driver-dependent and unsafe to apply to a reused pool thread. So the
  // registry keeps one in-flight check per path and later callers join it,
  // rather than each adding another stuck callback. Same bound and same
  // reasoning as the macOS probe registry in
  // src/darwin/volume_mount_points.cpp.
  static constexpr size_t kMaxInflightChecks = 64;

  static CheckRegistry *GetRegistry() {
    // Allocated lazily so allocation failure surfaces in a call rather than
    // during addon load, and deliberately leaked: an abandoned callback may
    // still retire its entry after static destructors have run.
    static CheckRegistry *const registry = new CheckRegistry();
    return registry;
  }

  struct DriveCheckTask {
    std::string path;
    std::shared_ptr<std::promise<DriveStatus>> status;
    std::shared_ptr<std::promise<DriveVolumeInfo>> volumeInfo;
    HMODULE module; // addon DLL reference released when the callback returns
    // Whether each promise has been given a value or an exception. Tracked
    // rather than discovered: node's common.gypi compiles this addon with
    // _HAS_EXCEPTIONS=0, so MSVC's standard library calls std::terminate()
    // where it would otherwise throw promise_already_satisfied. A second
    // set_value() kills the process, and no catch can intercept it. Only the
    // one callback thread that owns this task touches these.
    bool statusSettled = false;
    bool volumeInfoSettled = false;
  };

  template <typename T>
  static void Settle(std::promise<T> &promise, bool &settled, T value) {
    if (settled) {
      return;
    }
    settled = true;
    promise.set_value(std::move(value));
  }

  // Only valid while an exception is in flight: set_exception() rejects a null
  // exception_ptr.
  template <typename T>
  static void SettleWithException(std::promise<T> &promise, bool &settled) {
    if (settled) {
      return;
    }
    settled = true;
    promise.set_exception(std::current_exception());
  }

  // Drops the registry entry and guarantees both futures settle, however the
  // callback leaves. Erasing only after both are settled upholds what a joiner
  // relies on: an entry found under the lock always yields futures that
  // someone will satisfy.
  class RetireCheck {
    DriveCheckTask *task;

  public:
    explicit RetireCheck(DriveCheckTask *task) : task(task) {}
    RetireCheck(const RetireCheck &) = delete;
    RetireCheck &operator=(const RetireCheck &) = delete;
    RetireCheck(RetireCheck &&) = delete;
    RetireCheck &operator=(RetireCheck &&) = delete;

    ~RetireCheck() {
      CheckRegistry *const registry = GetRegistry();
      const std::lock_guard<std::mutex> lock(registry->mutex);
      Settle(*task->status, task->statusSettled, DriveStatus::Unknown);
      Settle(*task->volumeInfo, task->volumeInfoSettled, DriveVolumeInfo{});
      registry->inflight.erase(task->path);
    }
  };

  static void CALLBACK DriveCheckCallback(PTP_CALLBACK_INSTANCE instance,
                                          PVOID context) noexcept {
    std::unique_ptr<DriveCheckTask> task(
        static_cast<DriveCheckTask *>(context));

    // Release, when this callback returns, the addon DLL reference taken in
    // StartCheck. A Node Worker that is the addon's last loader unloads this
    // DLL (uv_dlclose) on teardown; without the held reference a probe still
    // blocked in the pool would return into unmapped code and crash.
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

    // Destroyed before `task`, so the task it points at is still alive.
    const RetireCheck retire(task.get());

    DriveStatus status = DriveStatus::Unknown;
    try {
      status = CheckDriveInternal(task->path);
      // Settled before the volume query below, so a caller waiting only on
      // the status is not made to wait for work it did not ask for.
      Settle(*task->status, task->statusSettled, status);
    } catch (const std::exception &e) {
      DEBUG_LOG("[DriveStatusChecker] Exception in CheckDriveInternal: %s",
                e.what());
      SettleWithException(*task->status, task->statusSettled);
      return;
    } catch (...) {
      DEBUG_LOG("[DriveStatusChecker] Unknown exception in "
                "CheckDriveInternal");
      SettleWithException(*task->status, task->statusSettled);
      return;
    }

    // Only a drive that answered has volume information to report, and
    // re-entering a provider that just failed can block for nothing.
    if (status != DriveStatus::Healthy) {
      return;
    }

    // Read unconditionally, even for a CheckDrive() caller that will not wait
    // for it: a check shared between enumeration and metadata callers cannot
    // produce different fields depending on which arrived first. On a healthy
    // drive this is a sub-millisecond local call. On one that stalls after
    // answering, it costs a second blocked thread beside the metadata
    // worker's own query — bounded, because only one such callback per path
    // can exist at a time.
    try {
      Settle(*task->volumeInfo, task->volumeInfoSettled,
             ReadVolumeInformation(task->path));
    } catch (const std::exception &e) {
      DEBUG_LOG("[DriveStatusChecker] Exception in ReadVolumeInformation: %s",
                e.what());
      SettleWithException(*task->volumeInfo, task->volumeInfoSettled);
    } catch (...) {
      DEBUG_LOG("[DriveStatusChecker] Unknown exception in "
                "ReadVolumeInformation");
      SettleWithException(*task->volumeInfo, task->volumeInfoSettled);
    }
  }

  // Returns the check running for `path`, submitting one if none is. Throws
  // if no check could be started, so one unstartable path cannot be mistaken
  // for a drive that answered.
  static InflightCheck StartCheck(const std::string &path) {
    CheckRegistry *const registry = GetRegistry();
    const std::lock_guard<std::mutex> lock(registry->mutex);

    const auto it = registry->inflight.find(path);
    if (it != registry->inflight.end()) {
      DEBUG_LOG("[DriveStatusChecker] Joining in-flight check for %s",
                path.c_str());
      // An entry whose callback has settled both futures but not yet retired
      // is joined too, and answers immediately from the value that callback
      // just computed. That window is microseconds wide; closing it would mean
      // retiring the entry before publishing the last value, which is exactly
      // what would let a joiner wait on a promise nobody satisfies.
      return it->second;
    }

    if (registry->inflight.size() >= kMaxInflightChecks) {
      throw std::runtime_error("fs-metadata: drive check queue busy");
    }

    auto statusPromise = std::make_shared<std::promise<DriveStatus>>();
    auto volumeInfoPromise = std::make_shared<std::promise<DriveVolumeInfo>>();
    const InflightCheck check{statusPromise->get_future().share(),
                              volumeInfoPromise->get_future().share()};

    // Registered before the submit because the callback can run to completion
    // — and retire its entry — before TrySubmitThreadpoolCallback returns. It
    // blocks on this mutex until we release it, so the entry is always there
    // to erase. Everything after this point unregisters on failure: a
    // stranded entry would make every later check of this path wait out its
    // whole timeout on promises nobody will satisfy.
    registry->inflight.emplace(path, check);
    try {
      // Allocated before the DLL reference is taken, so an allocation failure
      // cannot leak it.
      auto task = std::make_unique<DriveCheckTask>(
          DriveCheckTask{path, std::move(statusPromise),
                         std::move(volumeInfoPromise), nullptr});

      // Pin this addon DLL for the callback's lifetime. GetModuleHandleEx with
      // FROM_ADDRESS takes a reference (refcount++) that the callback releases
      // via FreeLibraryWhenCallbackReturns, so a Node Worker teardown cannot
      // unmap code the process thread pool is still running. Fail closed if
      // the reference cannot be taken rather than risk a use-after-unload.
      if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
                              reinterpret_cast<LPCWSTR>(&DriveCheckCallback),
                              &task->module)) {
        throw std::runtime_error("GetModuleHandleEx failed with error " +
                                 std::to_string(GetLastError()));
      }

      if (!TrySubmitThreadpoolCallback(DriveCheckCallback, task.get(),
                                       nullptr)) {
        const DWORD error = GetLastError();
        FreeLibrary(task->module); // no callback will run to release it
        throw std::runtime_error(
            "TrySubmitThreadpoolCallback failed with error " +
            std::to_string(error));
      }
      (void)task.release(); // callback owns and deletes the task
    } catch (...) {
      registry->inflight.erase(path);
      throw;
    }

    return check;
  }

  using Budget = std::optional<std::chrono::milliseconds>;

  // timeoutMs 0 disables the deadline (see Options.timeoutMs).
  static Budget WholeBudget(DWORD timeoutMs) {
    return timeoutMs == 0 ? Budget{}
                          : Budget{std::chrono::milliseconds(timeoutMs)};
  }

  // What is left of `timeoutMs` since `startTime`. An exhausted budget stays
  // present rather than becoming unbounded.
  static Budget
  RemainingBudget(DWORD timeoutMs,
                  const std::chrono::steady_clock::time_point &startTime) {
    if (timeoutMs == 0) {
      return Budget{};
    }
    const auto elapsedMs =
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - startTime)
            .count();
    const auto budgetMs = static_cast<long long>(timeoutMs);
    return Budget{std::chrono::milliseconds(
        elapsedMs < budgetMs ? budgetMs - elapsedMs : 0)};
  }

  // Waits on an already-running check with this caller's own budget. A zero
  // budget still polls: checks run concurrently, so one that finished while
  // an earlier drive consumed the budget must not be mislabeled as Timeout.
  template <typename T>
  static bool Settled(const std::shared_future<T> &future,
                      const Budget &budget) {
    if (!budget) {
      future.wait();
      return true;
    }
    return future.wait_for(*budget) != std::future_status::timeout;
  }

  // Collects one check's result within whatever is left of the batch budget.
  // The two waits are separate so a volume query that times out or fails does
  // not discard a status that succeeded.
  static DriveCheckResult
  CollectCheck(const InflightCheck &check, const std::string &path,
               DWORD timeoutMs,
               const std::chrono::steady_clock::time_point &startTime) {
    DriveCheckResult result;
    try {
      if (!Settled(check.status, RemainingBudget(timeoutMs, startTime))) {
        DEBUG_LOG("[DriveStatusChecker] Timeout waiting for drive %s",
                  path.c_str());
        result.status = DriveStatus::Timeout;
        return result;
      }
      // Ready - get the result (may throw if the callback set an exception)
      result.status = check.status.get();
    } catch (const std::exception &e) {
      DEBUG_LOG(
          "[DriveStatusChecker] Exception getting status for drive %s: %s",
          path.c_str(), e.what());
      return DriveCheckResult{};
    } catch (...) {
      DEBUG_LOG("[DriveStatusChecker] Unknown exception getting status for "
                "drive %s",
                path.c_str());
      return DriveCheckResult{};
    }

    if (result.status != DriveStatus::Healthy) {
      return result;
    }

    // The volume query runs in the same callback, so the filesystem type and
    // read-only flag share this budget rather than running unbounded after
    // enumeration has already reported the drive healthy.
    //
    // A drive that answered its probe and then stalled reports Timeout, not
    // Healthy. MountPoint::ToObject() serializes isReadOnly unconditionally
    // and compactValues() keeps `false`, so a Healthy result from a query that
    // never answered would assert that an unread volume is writable. Timeout
    // says what happened and matches what a drive whose probe timed out has
    // always reported. A query that answers FALSE is a different case, left
    // exactly as it was: Healthy with both fields at their defaults.
    try {
      if (!Settled(check.volumeInfo, RemainingBudget(timeoutMs, startTime))) {
        DEBUG_LOG("[DriveStatusChecker] Timeout reading volume information for "
                  "drive %s",
                  path.c_str());
        result.status = DriveStatus::Timeout;
        return result;
      }
      result.volumeInfo = check.volumeInfo.get();
    } catch (const std::exception &e) {
      // Same reasoning as the timeout above: do not report Healthy without a
      // definite answer about the volume. Reachable only if the path fails
      // wide-char conversion, which also fails the enumerator's own
      // conversion and rejects the whole call.
      DEBUG_LOG("[DriveStatusChecker] Exception reading volume information for "
                "drive %s: %s",
                path.c_str(), e.what());
      return DriveCheckResult{};
    } catch (...) {
      DEBUG_LOG("[DriveStatusChecker] Unknown exception reading volume "
                "information for drive %s",
                path.c_str());
      return DriveCheckResult{};
    }
    return result;
  }

public:
  // Status of one drive, bounded by timeoutMs. Joins a check already running
  // for this path instead of submitting another callback, and waits on it
  // with this caller's own deadline.
  //
  // Waits on the status future only: the metadata path reads the volume's
  // label, serial number and free space itself, so making it wait for the
  // enumeration-only volume query would double its stall.
  static DriveStatus CheckDrive(const std::string &path,
                                DWORD timeoutMs = 5000) {
    try {
      const InflightCheck check = StartCheck(path);

      if (!Settled(check.status, WholeBudget(timeoutMs))) {
        DEBUG_LOG("[DriveStatusChecker] Timeout waiting for drive %s",
                  path.c_str());
        return DriveStatus::Timeout;
      }

      // Ready - get the result (may throw if the callback set an exception)
      return check.status.get();
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

  // Status and volume information for several drives, with timeoutMs as the
  // budget for the whole batch. Every volume-touching call is inside it.
  static std::vector<DriveCheckResult>
  CheckMultipleDrives(const std::vector<std::string> &paths,
                      DWORD timeoutMs = 5000) {

    // Launch all checks concurrently. A path whose check is already in flight
    // joins it rather than adding a second callback.
    std::vector<std::optional<InflightCheck>> checks(paths.size());
    const auto startTime = std::chrono::steady_clock::now();
    for (size_t i = 0; i < paths.size(); ++i) {
      try {
        checks[i] = StartCheck(paths[i]);
      } catch (const std::exception &e) {
        DEBUG_LOG("[DriveStatusChecker] Could not start check for drive %s: %s",
                  paths[i].c_str(), e.what());
      } catch (...) {
        DEBUG_LOG("[DriveStatusChecker] Could not start check for drive %s",
                  paths[i].c_str());
      }
    }

    // Collect results with timeout
    std::vector<DriveCheckResult> results(paths.size());

    for (size_t i = 0; i < paths.size(); ++i) {
      if (checks[i]) {
        results[i] = CollectCheck(*checks[i], paths[i], timeoutMs, startTime);
      } // a check that could not be started stays Unknown
    }

    return results;
  }
};

// Compatibility wrappers for existing code
inline std::vector<DriveCheckResult>
CheckDrives(const std::vector<std::string> &paths, DWORD timeoutMs = 5000) {
  return DriveStatusChecker::CheckMultipleDrives(paths, timeoutMs);
}

inline DriveStatus CheckDriveStatus(const std::string &path,
                                    DWORD timeoutMs = 5000) {
  return DriveStatusChecker::CheckDrive(path, timeoutMs);
}

} // namespace FSMeta
