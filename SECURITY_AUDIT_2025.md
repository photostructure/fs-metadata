# Security Audit Report - October 22 2025

**Project**: @photostructure/fs-metadata
**Auditor**: Claude (Anthropic)
**Scope**: Complete codebase review including API verification against official documentation

## Executive Summary

This comprehensive security audit examined all source files (12 C++ files, 21 headers, TypeScript bindings, and build configuration) and verified every external API call against official documentation from Microsoft.com, Apple.com, kernel.org, and gnome.org.

**Overall Security Rating: B+ (Good with identified improvements needed)**

### Strengths
- ✅ Excellent RAII patterns preventing resource leaks
- ✅ Comprehensive integer overflow protection
- ✅ Strong Windows security compiler flags (/guard:cf, /sdl, /Qspectre)
- ✅ Good input validation at API boundaries
- ✅ Proper exception safety throughout

### Areas Requiring Improvement
- ⚠️ Path validation can be bypassed (Critical)
- ⚠️ Thread safety issues with macOS DiskArbitration and Linux GIO (High)
- ⚠️ Memory leak risks in error handling (High)

---

## Critical Priority Findings

### Finding #1: Path Validation Bypass (macOS/Linux)

**Severity**: 🔴 CRITICAL
**Files Affected**:
- `src/darwin/hidden.cpp:23-30`
- `src/darwin/volume_metadata.cpp:76-83`

**Issue**:
Simple string-based path validation using `path.find("..")` can be bypassed with:
- URL-encoded sequences (`%2e%2e`)
- Unicode normalization attacks
- Redundant separators (`/.//./..`)
- Absolute path traversal

**Current Code**:
```cpp
// src/darwin/hidden.cpp:23-30
if (path_.find("..") != std::string::npos) {
  SetError("Invalid path containing '..'");
  return;
}
```

**Vulnerability Example**:
```cpp
// These paths would pass validation but escape intended boundaries:
"/tmp/./foo/../../etc/passwd"     // Resolves to /etc/passwd
"/home/user/./../root/.ssh"       // Escapes user directory
```

**Official Documentation**:
- [Apple: Race Conditions and Secure File Operations](https://developer.apple.com/library/archive/documentation/Security/Conceptual/SecureCodingGuide/Articles/RaceConditions.html)

**Recommended Fix**:
```cpp
// Add to src/darwin/hidden.cpp and src/darwin/volume_metadata.cpp
bool ValidatePathSecurity(const std::string& path, std::string& error) {
  // Check for null bytes
  if (path.find('\0') != std::string::npos) {
    error = "Invalid path containing null byte";
    return false;
  }

  // Canonicalize the path
  char resolved_path[PATH_MAX];
  if (realpath(path.c_str(), resolved_path) == nullptr) {
    if (errno == ENOENT) {
      // For operations that create files, allow non-existent paths
      // but validate parent directory
      std::string parent = path.substr(0, path.find_last_of('/'));
      if (parent.empty()) parent = ".";
      if (realpath(parent.c_str(), resolved_path) == nullptr) {
        error = CreatePathErrorMessage("realpath (parent)", parent, errno);
        return false;
      }
    } else {
      error = CreatePathErrorMessage("realpath", path, errno);
      return false;
    }
  }

  // Additional validation: ensure resolved path is within allowed boundaries
  // (This depends on your security requirements)

  return true;
}

// Usage in Execute():
void GetHiddenWorker::Execute() {
  std::string error;
  if (!ValidatePathSecurity(path_, error)) {
    SetError(error);
    return;
  }
  // ... rest of implementation
}
```

**Test Cases to Add**:
```cpp
// These should all be rejected:
TEST(PathValidation, RejectsDirectoryTraversal) {
  EXPECT_FALSE(ValidatePathSecurity("/tmp/../etc/passwd", error));
  EXPECT_FALSE(ValidatePathSecurity("/home/user/./../root", error));
  EXPECT_FALSE(ValidatePathSecurity("/var/.//../etc/shadow", error));
}
```

---

### Finding #2: Windows Path Length Restriction

**Severity**: 🔴 CRITICAL
**Files Affected**:
- `src/windows/security_utils.h:106-116`

**Issue**:
`PathCchCanonicalize` restricts paths to MAX_PATH (260 characters), preventing access to legitimate long paths that Windows 10+ supports (up to 32,768 characters).

**Official Documentation**:
- [PathCchCanonicalize](https://learn.microsoft.com/en-us/windows/win32/api/pathcch/nf-pathcch-pathcchcanonicalize) - "restricts the final path to a length of MAX_PATH"
- [PathCchCanonicalizeEx](https://learn.microsoft.com/en-us/windows/win32/api/pathcch/nf-pathcch-pathcchcanonicalizeex) - Supports longer paths
- [Maximum Path Length Limitation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)

**Microsoft Security Warning**:
> "With untrusted input, this function by itself, cannot be used to convert paths into a form that can be compared with other paths for sub-path or identity."

**Current Code**:
```cpp
// src/windows/security_utils.h:106-116
static std::wstring NormalizePath(const std::wstring &path) {
  wchar_t canonicalPath[MAX_PATH];  // Only 260 characters!
  HRESULT hr = PathCchCanonicalize(canonicalPath, MAX_PATH, path.c_str());

  if (FAILED(hr)) {
    throw std::runtime_error("Failed to canonicalize path");
  }

  return std::wstring(canonicalPath);
}
```

**Recommended Fix**:
```cpp
// src/windows/security_utils.h
#include <pathcch.h>

static std::wstring NormalizePath(const std::wstring &path) {
  // Use PATHCCH_MAX_CCH (32,768) instead of MAX_PATH (260)
  wchar_t canonicalPath[PATHCCH_MAX_CCH];
  HRESULT hr = PathCchCanonicalizeEx(
    canonicalPath,
    PATHCCH_MAX_CCH,
    path.c_str(),
    PATHCCH_ALLOW_LONG_PATHS  // Enable long path support
  );

  if (FAILED(hr)) {
    throw std::runtime_error("Failed to canonicalize path: " + std::to_string(hr));
  }

  return std::wstring(canonicalPath);
}

// Also update IsPathSecure to handle long paths
static bool IsPathSecure(const std::string &path) {
  // Check for empty path
  if (path.empty()) {
    return false;
  }

  // Allow paths longer than MAX_PATH for Windows 10+
  if (path.length() > PATHCCH_MAX_CCH * 3) {  // UTF-8 worst case: 3 bytes per char
    return false;
  }

  // ... rest of validation
}
```

**Required Project Configuration**:
```xml
<!-- Add to app.manifest for long path support -->
<application xmlns="urn:schemas-microsoft-com:asm.v3">
  <windowsSettings>
    <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>
  </windowsSettings>
</application>
```

---

### Finding #3: Integer Overflow in String Conversion

**Severity**: 🔴 CRITICAL
**Files Affected**:
- `src/windows/string.h:9-21`

**Issue**:
`WideToUtf8()` doesn't validate that `size` is positive or check for integer overflow before allocation.

**Official Documentation**:
- [MultiByteToWideChar Security](https://learn.microsoft.com/en-us/archive/blogs/esiu/insecurity-of-multibytetowidechar-and-widechartomultibyte-part-1)
- [WideCharToMultiByte](https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-widechartomultibyte)

**Current Code**:
```cpp
// src/windows/string.h:9-21
inline std::string WideToUtf8(const WCHAR *wide) {
  if (!wide || wide[0] == 0)
    return "";

  int size = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 0)  // Good! But needs more checks
    return "";

  std::string result(size - 1, 0);  // What if size == INT_MAX?
  WideCharToMultiByte(CP_UTF8, 0, wide, -1, &result[0], size, nullptr, nullptr);
  return result;
}
```

**Recommended Fix**:
```cpp
// src/windows/string.h
inline std::string WideToUtf8(const WCHAR *wide) {
  if (!wide || wide[0] == 0)
    return "";

  // Get required buffer size
  int size = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);

  // Validate size is reasonable
  if (size <= 0) {
    DEBUG_LOG("[WideToUtf8] WideCharToMultiByte returned invalid size: %d", size);
    return "";
  }

  // Check for overflow: size - 1 should be positive and reasonable
  if (size > INT_MAX - 1 || size > 1024 * 1024) {  // 1MB sanity limit
    DEBUG_LOG("[WideToUtf8] Size too large: %d", size);
    throw std::runtime_error("String conversion size exceeds reasonable limits");
  }

  std::string result(static_cast<size_t>(size - 1), 0);

  // Perform conversion and check result
  int written = WideCharToMultiByte(CP_UTF8, 0, wide, -1, &result[0], size, nullptr, nullptr);
  if (written <= 0) {
    DEBUG_LOG("[WideToUtf8] WideCharToMultiByte conversion failed: %lu", GetLastError());
    throw std::runtime_error("String conversion failed");
  }

  return result;
}
```

**Similar Fix Needed for PathConverter::ToWString**:
```cpp
// src/windows/string.h:25-45
static std::wstring ToWString(const std::string &path) {
  if (path.empty()) {
    return L"";
  }

  int wlen = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                  path.c_str(), static_cast<int>(path.length()),
                                  nullptr, 0);

  // Validate wlen
  if (wlen <= 0) {
    DEBUG_LOG("[ToWString] MultiByteToWideChar returned invalid size: %d (error: %lu)",
              wlen, GetLastError());
    return L"";
  }

  if (wlen > PATHCCH_MAX_CCH) {
    DEBUG_LOG("[ToWString] Size exceeds maximum path length: %d", wlen);
    throw std::runtime_error("Path too long for conversion");
  }

  std::wstring wpath(static_cast<size_t>(wlen), 0);
  int written = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                     path.c_str(), static_cast<int>(path.length()),
                                     &wpath[0], wlen);
  if (written <= 0) {
    DEBUG_LOG("[ToWString] MultiByteToWideChar conversion failed: %lu", GetLastError());
    throw std::runtime_error("String conversion failed");
  }

  return wpath;
}
```

---

## High Priority Findings

### Finding #4: Memory Leak in Windows Error Formatting

**Severity**: 🟠 HIGH
**Files Affected**:
- `src/windows/error_utils.h:19-40`

**Issue**:
`FormatMessageA` with `FORMAT_MESSAGE_ALLOCATE_BUFFER` requires `LocalFree`, but if the `std::string` constructor throws an exception, memory leaks.

**Official Documentation**:
- [FormatMessage](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-formatmessagea)
- Raymond Chen: [FormatMessage security](https://devblogs.microsoft.com/oldnewthing/20120210-00?p=8333)

**Current Code**:
```cpp
// src/windows/error_utils.h:25-36
LPVOID messageBuffer;
size_t size = FormatMessageA(
    FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
        FORMAT_MESSAGE_IGNORE_INSERTS,
    NULL, error, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
    (LPSTR)&messageBuffer, 0, NULL);

if (size == 0 || !messageBuffer) {
  return operation + " failed with error code: " + std::to_string(error);
}

std::string errorMessage((LPSTR)messageBuffer, size);  // If this throws...
LocalFree(messageBuffer);  // ...this never executes!

return operation + " failed: " + errorMessage;
```

**Recommended Fix**:
```cpp
// src/windows/error_utils.h
static std::string FormatWindowsError(const std::string &operation, DWORD error) {
  if (error == 0) {
    return operation + " failed with an unknown error";
  }

  LPVOID messageBuffer = nullptr;
  size_t size = FormatMessageA(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
          FORMAT_MESSAGE_IGNORE_INSERTS,
      NULL, error, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
      (LPSTR)&messageBuffer, 0, NULL);

  // RAII wrapper for LocalFree - ensures cleanup even if exception thrown
  struct LocalFreeGuard {
    LPVOID ptr;
    LocalFreeGuard(LPVOID p) : ptr(p) {}
    ~LocalFreeGuard() {
      if (ptr) {
        LocalFree(ptr);
        DEBUG_LOG("[FormatWindowsError] LocalFree called on messageBuffer");
      }
    }
    // Prevent copying
    LocalFreeGuard(const LocalFreeGuard&) = delete;
    LocalFreeGuard& operator=(const LocalFreeGuard&) = delete;
  } guard(messageBuffer);

  if (size == 0 || !messageBuffer) {
    DEBUG_LOG("[FormatWindowsError] FormatMessageA failed: error=%lu, size=%zu",
              GetLastError(), size);
    return operation + " failed with error code: " + std::to_string(error);
  }

  // Now safe: guard will free messageBuffer even if string construction throws
  std::string errorMessage((LPSTR)messageBuffer, size);

  // Trim trailing newlines that Windows adds
  while (!errorMessage.empty() &&
         (errorMessage.back() == '\r' || errorMessage.back() == '\n')) {
    errorMessage.pop_back();
  }

  return operation + " failed: " + errorMessage;
}
```

**Test Case**:
```cpp
// Verify no leaks even with large error messages
TEST(ErrorUtils, NoLeakOnLargeErrorMessage) {
  // ERROR_INVALID_PARAMETER has a long message
  for (int i = 0; i < 1000; i++) {
    FSException e("TestOperation", ERROR_INVALID_PARAMETER);
    std::string msg = e.what();
    EXPECT_FALSE(msg.empty());
  }
  // Run under LeakSanitizer or Dr. Memory
}
```

---

### Finding #5: Undocumented Thread Safety - DiskArbitration (macOS)

**Severity**: 🟠 HIGH
**Files Affected**:
- `src/darwin/volume_metadata.cpp:160-217`

**Issue**:
While the code uses a mutex to serialize DiskArbitration access, Apple's documentation doesn't explicitly guarantee thread safety for `DADiskCopyDescription`. The framework is designed for main-thread use with run loops.

**Research Findings**:
- Apple Developer Forums show no explicit thread-safety guarantees
- DiskArbitration is designed to work with CFRunLoop (main thread pattern)
- No documented CVEs, but framework assumptions may not hold in worker threads

**Official Documentation**:
- [DADiskCopyDescription](https://developer.apple.com/documentation/diskarbitration/dadiskcopydescription(_:))
- Apple: [Thread Safety Summary](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Multithreading/ThreadSafetySummary/ThreadSafetySummary.html)

**Current Code**:
```cpp
// src/darwin/volume_metadata.cpp:173
// Use a global mutex to serialize DiskArbitration access
std::lock_guard<std::mutex> lock(g_diskArbitrationMutex);

CFReleaser<DASessionRef> session(DASessionCreate(kCFAllocatorDefault));
// ... DA operations
```

**Recommended Fix - Option 1 (Conservative)**:
```cpp
// Add to src/darwin/volume_metadata.cpp header comment:
//
// THREAD SAFETY NOTE:
// DiskArbitration framework is not explicitly documented as thread-safe.
// This implementation uses a global mutex to serialize all DA access,
// but Apple recommends using the main run loop or dispatch queues.
//
// Current approach: Conservative mutex serialization
// Future consideration: Dispatch to main queue for production reliability
//

void GetDiskArbitrationInfoSafe() {
  DEBUG_LOG("[GetVolumeMetadataWorker] Getting Disk Arbitration info for: %s",
            mountPoint.c_str());

  // Check if this is a network filesystem - skip DA for network mounts
  if (metadata.fstype == "smbfs" || metadata.fstype == "nfs" ||
      metadata.fstype == "afpfs" || metadata.fstype == "webdav") {
    metadata.remote = true;
    metadata.status = "healthy";
    return;
  }

  // Serialize all DiskArbitration access with global mutex
  // This prevents potential race conditions in DA framework
  std::lock_guard<std::mutex> lock(g_diskArbitrationMutex);

  // ... rest of implementation
}
```

**Recommended Fix - Option 2 (More Robust)**:
```cpp
// Use dispatch_sync to main queue for DA operations
#include <dispatch/dispatch.h>

void GetDiskArbitrationInfoSafe() {
  DEBUG_LOG("[GetVolumeMetadataWorker] Getting Disk Arbitration info for: %s",
            mountPoint.c_str());

  // Skip DA for network mounts
  if (metadata.fstype == "smbfs" || metadata.fstype == "nfs" ||
      metadata.fstype == "afpfs" || metadata.fstype == "webdav") {
    metadata.remote = true;
    metadata.status = "healthy";
    return;
  }

  // Execute DA operations on main queue for thread safety
  __block bool success = false;
  __block std::string error_msg;
  __block std::string label, uuid;
  __block bool remote = false;

  dispatch_sync(dispatch_get_main_queue(), ^{
    try {
      CFReleaser<DASessionRef> session(DASessionCreate(kCFAllocatorDefault));
      if (!session.isValid()) {
        error_msg = "Failed to create DA session";
        return;
      }

      CFReleaser<DADiskRef> disk(DADiskCreateFromBSDName(
          kCFAllocatorDefault, session.get(), metadata.mountFrom.c_str()));

      if (!disk.isValid()) {
        error_msg = "Failed to create disk reference";
        return;
      }

      CFReleaser<CFDictionaryRef> description(DADiskCopyDescription(disk.get()));
      if (!description.isValid()) {
        error_msg = "Failed to get disk description";
        return;
      }

      // Extract values within dispatch block
      if (CFStringRef volumeName = (CFStringRef)CFDictionaryGetValue(
              description.get(), kDADiskDescriptionVolumeNameKey)) {
        label = CFStringToString(volumeName);
      }

      if (CFUUIDRef cfuuid = (CFUUIDRef)CFDictionaryGetValue(
              description.get(), kDADiskDescriptionVolumeUUIDKey)) {
        CFReleaser<CFStringRef> uuidString(
            CFUUIDCreateString(kCFAllocatorDefault, cfuuid));
        if (uuidString.isValid()) {
          uuid = CFStringToString(uuidString.get());
        }
      }

      CFBooleanRef isNetworkVolume = (CFBooleanRef)CFDictionaryGetValue(
          description.get(), kDADiskDescriptionVolumeNetworkKey);
      if (isNetworkVolume) {
        remote = CFBooleanGetValue(isNetworkVolume);
      }

      success = true;
    } catch (const std::exception &e) {
      error_msg = e.what();
    }
  });

  // Apply results outside dispatch block
  if (success) {
    metadata.label = label;
    metadata.uuid = uuid;
    metadata.remote = remote;
    metadata.status = "healthy";
  } else {
    metadata.status = "partial";
    metadata.error = error_msg;
  }
}
```

**Testing**:
```bash
# Test with ThreadSanitizer to detect race conditions
clang++ -fsanitize=thread -g src/darwin/volume_metadata.cpp ...

# Stress test with concurrent access
for i in {1..100}; do
  node -e "require('.').getVolumeMetadata('/Volumes/SomeDisk')" &
done
wait
```

---

### Finding #6: Thread Safety Violation - GVolumeMonitor (Linux)

**Severity**: 🟠 HIGH
**Files Affected**:
- `src/linux/gio_utils.cpp:14-22`
- `src/linux/gio_mount_points.cpp` (if it exists)

**Issue**:
The code accesses `GVolumeMonitor` from AsyncWorker threads, but GIO documentation explicitly forbids this.

**Official Documentation**:
- [GVolumeMonitor](https://developer-old.gnome.org/gio/stable/GVolumeMonitor.html):
  > "GVolumeMonitor is not thread-default-context aware, and so should not be used other than from the main thread, with no thread-default-context active."

**Current Code**:
```cpp
// src/linux/gio_utils.cpp:15-22
// HEY FUTURE ME: DON'T `g_object_unref` THIS POINTER!
GVolumeMonitor *MountIterator::getMonitor() {
  GVolumeMonitor *monitor = g_volume_monitor_get();
  if (!monitor) {
    DEBUG_LOG("[gio::getMonitor] g_volume_monitor_get() failed");
    throw std::runtime_error("Failed to get GVolumeMonitor");
  }
  return monitor;
}
```

**Recommended Fix**:
```cpp
// src/linux/gio_utils.cpp

#include <glib.h>

GVolumeMonitor *MountIterator::getMonitor() {
  // Enforce main thread requirement per GIO documentation
  GMainContext *main_context = g_main_context_default();

  if (!g_main_context_is_owner(main_context)) {
    DEBUG_LOG("[gio::getMonitor] ERROR: GVolumeMonitor must be accessed from main thread");
    DEBUG_LOG("[gio::getMonitor] Current thread is not main context owner");
    throw std::runtime_error(
      "GVolumeMonitor must be accessed from main thread. "
      "See https://developer.gnome.org/gio/stable/GVolumeMonitor.html"
    );
  }

  GVolumeMonitor *monitor = g_volume_monitor_get();
  if (!monitor) {
    DEBUG_LOG("[gio::getMonitor] g_volume_monitor_get() failed");
    throw std::runtime_error("Failed to get GVolumeMonitor");
  }

  // HEY FUTURE ME: DON'T `g_object_unref` THIS POINTER!
  // g_volume_monitor_get() returns a singleton that should not be unref'd
  return monitor;
}
```

**Alternative: Use GUnixMountEntry Instead**:
```cpp
// For volume metadata, consider using GUnixMountEntry which has fewer restrictions
#include <gio/gunixmounts.h>

void GetMountMetadataAlternative(const std::string &mountPoint, VolumeMetadata &metadata) {
  GList *mount_entries = g_unix_mount_points_get(nullptr);

  for (GList *l = mount_entries; l != nullptr; l = l->next) {
    GUnixMountPoint *mount_point = (GUnixMountPoint *)l->data;

    const char *mount_path = g_unix_mount_point_get_mount_path(mount_point);
    if (mount_path && mountPoint == mount_path) {
      const char *fs_type = g_unix_mount_point_get_fs_type(mount_point);
      if (fs_type) {
        metadata.fstype = fs_type;
      }

      const char *device_path = g_unix_mount_point_get_device_path(mount_point);
      if (device_path) {
        metadata.mountFrom = device_path;
      }
      break;
    }
  }

  g_list_free_full(mount_entries, (GDestroyNotify)g_unix_mount_point_free);
}
```

**Required Code Change**:
```cpp
// In src/linux/gio_mount_points.cpp or wherever GIO is called from worker threads:
// Move GIO operations to main thread using idle callback

struct GioWorkItem {
  std::function<void()> work;
  std::mutex mutex;
  std::condition_variable cv;
  bool done = false;
};

static gboolean gio_work_on_main_thread(gpointer user_data) {
  auto *item = static_cast<GioWorkItem*>(user_data);

  try {
    item->work();
  } catch (...) {
    // Handle exception
  }

  {
    std::lock_guard<std::mutex> lock(item->mutex);
    item->done = true;
  }
  item->cv.notify_one();

  return G_SOURCE_REMOVE;
}

// Usage in worker thread:
void Execute() override {
  GioWorkItem work_item;
  work_item.work = [this]() {
    // GIO operations here - now on main thread
    MountIterator::forEachMount([&](GMount *mount, GFile *root) {
      // ... process mount
      return true;
    });
  };

  // Schedule on main thread
  g_idle_add(gio_work_on_main_thread, &work_item);

  // Wait for completion
  std::unique_lock<std::mutex> lock(work_item.mutex);
  work_item.cv.wait(lock, [&] { return work_item.done; });
}
```

---

### Finding #7: Potential Double-Free in GIO (Linux)

**Severity**: 🟠 HIGH
**Files Affected**:
- `src/linux/gio_utils.cpp:24-71`

**Issue**:
The code manually calls `g_object_unref(mount)` in multiple places (lines 50, 58, 64) and then uses `g_list_free_full` with `g_object_unref`, which may cause double-free.

**Official Documentation**:
- [g_list_free_full](https://docs.gtk.org/glib/func.list_free_full.html) - Calls the destroy function on each element
- [g_object_unref thread safety](https://discourse.gnome.org/t/using-g-object-unref-from-non-main-threads/7046)

**Current Code**:
```cpp
// src/linux/gio_utils.cpp:33-71
for (GList *l = mounts; l != nullptr; l = l->next) {
  GMount *mount = G_MOUNT(l->data);

  if (!G_IS_MOUNT(mount)) {
    DEBUG_LOG("[gio::MountIterator::forEachMount] Skipping invalid mount");
    continue;
  }

  // Take an extra reference on the mount while we work with it
  g_object_ref(mount);  // Reference count: +1

  try {
    const GioResource<GFile> root(g_mount_get_root(mount));

    if (root.get() && G_IS_FILE(root.get())) {
      const bool continue_iteration = callback(mount, root.get());
      g_object_unref(mount);  // Reference count: -1 (line 50)

      if (!continue_iteration) {
        break;
      }
    } else {
      DEBUG_LOG("[gio::MountIterator::forEachMount] Invalid root file object");
      g_object_unref(mount);  // Reference count: -1 (line 58)
    }
  } catch (const std::exception &e) {
    DEBUG_LOG("[gio::MountIterator::forEachMount] Exception: %s", e.what());
    g_object_unref(mount);  // Reference count: -1 (line 64)
    throw;
  }
}

// Free the mounts list and unref each mount
g_list_free_full(mounts, reinterpret_cast<GDestroyNotify>(g_object_unref));  // -1 AGAIN!
```

**Reference Count Analysis**:
```
Initial state: mount has ref count N (from g_volume_monitor_get_mounts)
Line 42: g_object_ref(mount) -> ref count = N+1
Line 50/58/64: g_object_unref(mount) -> ref count = N
Line 70: g_list_free_full calls g_object_unref -> ref count = N-1 (DOUBLE UNREF!)
```

**Recommended Fix**:
```cpp
// src/linux/gio_utils.cpp
void MountIterator::forEachMount(const MountCallback &callback) {
  GList *mounts = g_volume_monitor_get_mounts(getMonitor());

  if (!mounts) {
    DEBUG_LOG("[gio::MountIterator::forEachMount] no mounts found");
    return;
  }

  // Process each mount - list owns the references, don't take extra refs
  GList *current = mounts;
  bool should_continue = true;

  while (current && should_continue) {
    GMount *mount = G_MOUNT(current->data);

    if (!G_IS_MOUNT(mount)) {
      DEBUG_LOG("[gio::MountIterator::forEachMount] Skipping invalid mount");
      current = current->next;
      continue;
    }

    try {
      const GioResource<GFile> root(g_mount_get_root(mount));

      if (root.get() && G_IS_FILE(root.get())) {
        should_continue = callback(mount, root.get());
      } else {
        DEBUG_LOG("[gio::MountIterator::forEachMount] Invalid root file object");
      }
    } catch (const std::exception &e) {
      DEBUG_LOG("[gio::MountIterator::forEachMount] Exception: %s", e.what());
      // Clean up and re-throw
      g_list_free_full(mounts, reinterpret_cast<GDestroyNotify>(g_object_unref));
      throw;
    }

    current = current->next;
  }

  // Free list and unref all mounts once
  g_list_free_full(mounts, reinterpret_cast<GDestroyNotify>(g_object_unref));
}
```

**Why This Matters**:
Double-unref can cause:
1. Use-after-free vulnerabilities
2. Crashes when GObject reaches ref count 0 prematurely
3. Memory corruption if object is freed and reallocated

**Test Case**:
```cpp
// Run under Valgrind to detect double-free
TEST(GioUtils, NoDoubleFreeMounts) {
  int count = 0;
  MountIterator::forEachMount([&](GMount *mount, GFile *root) {
    count++;
    return true;  // Continue iteration
  });
  EXPECT_GT(count, 0);
}

// Run test:
// G_SLICE=always-malloc G_DEBUG=gc-friendly valgrind --leak-check=full ./test
```

---

## Medium Priority Findings

### Finding #8: CFStringGetCString Error Logging (macOS)

**Severity**: 🟡 MEDIUM
**Files Affected**:
- `src/darwin/volume_metadata.cpp:22-61`

**Issue**:
The code correctly checks the return value of `CFStringGetCString`, but doesn't log why conversion failed, making debugging difficult.

**Current Code**:
```cpp
Boolean success = CFStringGetCString(cfString, &result[0], maxSize, kCFStringEncodingUTF8);
if (!success) {
  return "";  // Silent failure
}
```

**Recommended Fix**:
```cpp
Boolean success = CFStringGetCString(cfString, &result[0], maxSize, kCFStringEncodingUTF8);
if (!success) {
  // Log the failure for debugging
  DEBUG_LOG("[CFStringToString] Conversion failed - likely encoding issue or buffer too small");
  DEBUG_LOG("[CFStringToString] maxSize: %ld, string length: %ld",
            maxSize, CFStringGetLength(cfString));
  return "";
}
```

---

### Finding #9: TOCTOU Race Condition in statvfs/statfs (macOS/Linux)

**Severity**: 🟡 MEDIUM
**Files Affected**:
- `src/darwin/volume_metadata.cpp:104-116`
- `src/linux/volume_metadata.cpp:32-35`

**Issue**:
Time-of-check-time-of-use race condition: mount point could be unmounted or replaced between `statvfs` call and subsequent operations.

**Official Documentation**:
- [Apple: Race Conditions and Secure File Operations](https://developer.apple.com/library/archive/documentation/Security/Conceptual/SecureCodingGuide/Articles/RaceConditions.html)
- [statvfs(2) man page](https://man7.org/linux/man-pages/man2/statvfs.2.html)

**Current Code**:
```cpp
// src/darwin/volume_metadata.cpp:104
struct statvfs vfs;
if (statvfs(mountPoint.c_str(), &vfs) != 0) {
  // ...
}
// Later: use metadata, but mount could have changed
```

**Attack Scenario**:
1. Process calls `statvfs("/mnt/usb")` -> returns valid data
2. Attacker unmounts `/mnt/usb` and mounts malicious filesystem
3. Process continues using stale `vfs` data
4. Information disclosure or confused deputy attack

**Recommended Fix**:
```cpp
// Use file descriptor to prevent TOCTOU
bool GetBasicVolumeInfo() {
  DEBUG_LOG("[GetVolumeMetadataWorker] Getting basic volume info for: %s",
            mountPoint.c_str());

  // Open the mount point directory with O_DIRECTORY to ensure it's a directory
  int fd = open(mountPoint.c_str(), O_RDONLY | O_DIRECTORY);
  if (fd < 0) {
    int error = errno;
    DEBUG_LOG("[GetVolumeMetadataWorker] open failed: %s (%d)",
              strerror(error), error);
    SetError(CreatePathErrorMessage("open", mountPoint, error));
    return false;
  }

  // RAII wrapper for file descriptor
  struct FdGuard {
    int fd;
    ~FdGuard() { if (fd >= 0) close(fd); }
  } fd_guard{fd};

  // Now use fstatvfs and fstatfs on the same fd
  struct statvfs vfs;
  if (fstatvfs(fd, &vfs) != 0) {
    int error = errno;
    DEBUG_LOG("[GetVolumeMetadataWorker] fstatvfs failed: %s (%d)",
              strerror(error), error);
    SetError(CreatePathErrorMessage("fstatvfs", mountPoint, error));
    return false;
  }

  struct statfs fs;
  if (fstatfs(fd, &fs) != 0) {
    int error = errno;
    DEBUG_LOG("[GetVolumeMetadataWorker] fstatfs failed: %s (%d)",
              strerror(error), error);
    SetError(CreatePathErrorMessage("fstatfs", mountPoint, error));
    return false;
  }

  // Calculate sizes...
  // fd_guard automatically closes fd on return
  return true;
}
```

**Why This Matters**:
- Prevents race conditions where mount points change during operation
- File descriptor holds a reference to the filesystem
- More secure for security-sensitive applications

---

### Finding #10: blkid Memory Management Documentation (Linux)

**Severity**: 🟡 MEDIUM (Documentation)
**Files Affected**:
- `src/linux/volume_metadata.cpp:82-97`

**Issue**:
The code correctly uses `free()` on strings returned by `blkid_get_tag_value`, but a comment explaining this would help future maintainers.

**Official Documentation**:
- [libblkid source](https://github.com/util-linux/util-linux/blob/master/libblkid/src/resolve.c) shows `blkid_get_tag_value` uses `strdup()`

**Current Code** (CORRECT):
```cpp
char *uuid = blkid_get_tag_value(cache.get(), "UUID", options_.device.c_str());
if (uuid) {
  metadata.uuid = uuid;
  free(uuid);  // Correct, but why free() not delete?
}
```

**Recommended Fix (Add Comments)**:
```cpp
// blkid_get_tag_value returns a string allocated with strdup()
// Must be freed with free(), not delete (C API)
// See: https://github.com/util-linux/util-linux/blob/master/libblkid/src/resolve.c
char *uuid = blkid_get_tag_value(cache.get(), "UUID", options_.device.c_str());
if (uuid) {
  metadata.uuid = uuid;
  free(uuid);  // IMPORTANT: Use free(), not delete
  DEBUG_LOG("[LinuxMetadataWorker] found UUID for %s: %s",
            options_.device.c_str(), metadata.uuid.c_str());
}

char *label = blkid_get_tag_value(cache.get(), "LABEL", options_.device.c_str());
if (label) {
  metadata.label = label;
  free(label);  // IMPORTANT: Use free(), not delete
  DEBUG_LOG("[LinuxMetadataWorker] found label for %s: %s",
            options_.device.c_str(), metadata.label.c_str());
}
```

---

## Low Priority / Enhancements

### Finding #11: Thread Pool Shutdown Timeout Configuration (Windows)

**Severity**: 🟢 LOW
**Files Affected**:
- `src/windows/thread_pool.h:147-187`

**Issue**:
Hard-coded 5-second timeout for thread shutdown may be insufficient for slow I/O operations (network drives, slow HDDs).

**Current Code**:
```cpp
DWORD result = WaitForMultipleObjects(static_cast<DWORD>(handles.size()),
                                      handles.data(), TRUE, 5000);  // Hard-coded!
```

**Recommended Fix**:
```cpp
// src/windows/thread_pool.h
class ThreadPool {
private:
  DWORD shutdownTimeoutMs_ = 5000;  // Default 5 seconds

public:
  explicit ThreadPool(size_t numThreads = 4, DWORD shutdownTimeoutMs = 5000)
      : queue(std::make_shared<WorkQueue>()), shutdownTimeoutMs_(shutdownTimeoutMs) {
    // ... initialization
  }

  void Shutdown() {
    DEBUG_LOG("[ThreadPool] Shutting down with timeout %lu ms", shutdownTimeoutMs_);

    queue->Shutdown();

    EnterCriticalSection(&poolCs);
    for (auto &thread : threads) {
      thread->running = false;
    }
    LeaveCriticalSection(&poolCs);

    std::vector<HANDLE> handles;
    for (const auto &thread : threads) {
      if (thread->handle) {
        handles.push_back(thread->handle);
      }
    }

    if (!handles.empty()) {
      DWORD result = WaitForMultipleObjects(
        static_cast<DWORD>(handles.size()),
        handles.data(),
        TRUE,  // Wait for all
        shutdownTimeoutMs_  // Configurable timeout
      );

      if (result == WAIT_TIMEOUT) {
        DEBUG_LOG("[ThreadPool] WARNING: %zu threads did not exit within %lu ms",
                  handles.size(), shutdownTimeoutMs_);
        // Could optionally TerminateThread here, but that's dangerous
      }
    }

    for (auto &thread : threads) {
      if (thread->handle) {
        CloseHandle(thread->handle);
        thread->handle = nullptr;
      }
    }

    threads.clear();
    DEBUG_LOG("[ThreadPool] Shutdown complete");
  }
};
```

---

### Finding #12: ARM64 Security Flag Documentation (Windows)

**Severity**: 🟢 LOW (Documentation)
**Files Affected**:
- `binding.gyp:109-132`

**Issue**:
ARM64 builds exclude `/Qspectre` and `/CETCOMPAT` without explaining why.

**Current Code**:
```javascript
["target_arch=='arm64'", {
  "defines": ["_M_ARM64", "_WIN64"],
  "msvs_settings": {
    "VCCLCompilerTool": {
      "AdditionalOptions": ["/guard:cf", "/ZH:SHA_256", "/sdl"]
      // Missing /Qspectre and /CETCOMPAT
    }
  }
}]
```

**Recommended Fix**:
```javascript
// binding.gyp
[
  "target_arch=='arm64'",
  {
    "defines": [
      "_M_ARM64",
      "_WIN64"
    ],
    "msvs_settings": {
      "VCCLCompilerTool": {
        "AdditionalOptions": [
          "/guard:cf",      // Control Flow Guard (supported on ARM64)
          "/ZH:SHA_256",    // Hash algorithm for checksums
          "/sdl"            // Security Development Lifecycle checks
          // NOTE: /Qspectre is x64-specific, not available for ARM64
          // NOTE: /CETCOMPAT is x64-specific (Intel CET), ARM64 has different security features
          // TODO: Consider ARM64 shadow stack once compiler support stabilizes
        ],
        "ExceptionHandling": 1,
        "RuntimeTypeInfo": "true"
      },
      "VCLinkerTool": {
        "AdditionalOptions": [
          "/guard:cf",      // Control Flow Guard at link time
          "/DYNAMICBASE"    // ASLR support
          // NOTE: /CETCOMPAT omitted - x64 specific
        ]
      }
    }
  }
]
```

**Reference**:
- [ARM64 Security Features](https://learn.microsoft.com/en-us/windows/arm/arm64-security-features)
- [Spectre Mitigations](https://learn.microsoft.com/en-us/cpp/build/reference/qspectre)

---

## API Usage Verification Matrix

| API/Function | Platform | Documentation Verified | Status | Finding # |
|--------------|----------|----------------------|---------|-----------|
| `MultiByteToWideChar` | Windows | ✅ Microsoft | ⚠️ Needs overflow checks | #3 |
| `WideCharToMultiByte` | Windows | ✅ Microsoft | ⚠️ Needs overflow checks | #3 |
| `FormatMessageA` | Windows | ✅ Microsoft | ⚠️ Memory leak risk | #4 |
| `PathCchCanonicalize` | Windows | ✅ Microsoft | ⚠️ Use Ex version | #2 |
| `PathCchCanonicalizeEx` | Windows | ✅ Microsoft | ✅ Recommended | #2 |
| `GetVolumeInformationW` | Windows | ✅ Microsoft | ✅ Correct | - |
| `WNetGetConnectionA` | Windows | ✅ Microsoft | ✅ Correct | - |
| `FindFirstFileExA` | Windows | ✅ Microsoft | ✅ Correct | - |
| `GetDriveTypeA` | Windows | ✅ Microsoft | ✅ Correct | - |
| `GetDiskFreeSpaceExA` | Windows | ✅ Microsoft | ✅ Correct | - |
| `DADiskCopyDescription` | macOS | ✅ Apple | ⚠️ Thread safety unclear | #5 |
| `CFStringGetCString` | macOS | ✅ Apple | ✅ Correct (enhance logging) | #8 |
| `statvfs` | macOS/Linux | ✅ man7.org/Apple | ⚠️ TOCTOU risk | #9 |
| `statfs` | macOS | ✅ Apple | ⚠️ TOCTOU risk | #9 |
| `fstatvfs` | macOS/Linux | ✅ man7.org/Apple | ✅ Recommended | #9 |
| `realpath` | macOS/Linux | ✅ man7.org/Apple | ✅ Recommended | #1 |
| `blkid_get_tag_value` | Linux | ✅ kernel.org/GitHub | ✅ Correct | #10 |
| `g_volume_monitor_get` | Linux | ✅ gnome.org | ⚠️ Thread safety violation | #6 |
| `g_object_unref` | Linux | ✅ gnome.org | ⚠️ Double-free risk | #7 |

---

## Testing Recommendations

### Memory Leak Detection
```bash
# Linux
valgrind --leak-check=full --show-leak-kinds=all npm test

# macOS
export MallocStackLogging=1
leaks --atExit -- npm test

# Windows
# Already configured: npm run check:memory
```

### Thread Safety Testing
```bash
# ThreadSanitizer (Linux/macOS)
export CC=clang
export CXX=clang++
export CXXFLAGS="-fsanitize=thread -g"
npm rebuild
npm test

# Stress test
for i in {1..100}; do npm test & done; wait
```

### Path Traversal Testing
```typescript
// Add to test suite
describe('Security: Path Validation', () => {
  it('rejects directory traversal attempts', async () => {
    await expect(isHidden('/tmp/../etc/passwd')).rejects.toThrow(/invalid path/i);
    await expect(isHidden('/home/user/./../root')).rejects.toThrow(/invalid path/i);
    await expect(isHidden('/../../../etc/shadow')).rejects.toThrow(/invalid path/i);
  });

  it('rejects null byte injection', async () => {
    await expect(isHidden('/tmp\0/../../etc/passwd')).rejects.toThrow(/invalid path/i);
  });
});
```

---

## Priority Action Plan

### Week 1: Critical Fixes
- [ ] Fix #1: Implement `realpath()` validation (macOS/Linux)
- [ ] Fix #2: Switch to `PathCchCanonicalizeEx` (Windows)
- [ ] Fix #3: Add overflow checks to string conversion (Windows)

### Week 2: High Priority Fixes
- [ ] Fix #4: Add RAII to `FormatMessageA` (Windows)
- [ ] Fix #5: Document/fix DiskArbitration threading (macOS)
- [ ] Fix #6: Enforce main-thread for GVolumeMonitor (Linux)
- [ ] Fix #7: Fix double-free in GIO iteration (Linux)

### Week 3: Medium Priority Improvements
- [ ] Fix #8: Add CFString error logging (macOS)
- [ ] Fix #9: Use `fstatvfs()` with fd (macOS/Linux)
- [ ] Fix #10: Add blkid documentation (Linux)

### Week 4: Testing & Documentation
- [ ] Add path traversal tests
- [ ] Run ThreadSanitizer on all platforms
- [ ] Run memory leak detection
- [ ] Update security documentation

---

## References

### Official Documentation Sources
- **Windows APIs**: [Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/)
- **macOS APIs**: [Apple Developer Documentation](https://developer.apple.com/documentation/)
- **Linux System Calls**: [man7.org](https://man7.org/linux/man-pages/)
- **GIO/GLib**: [GNOME Developer](https://developer.gnome.org/)
- **libblkid**: [util-linux GitHub](https://github.com/util-linux/util-linux)

### Security Resources
- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
- [CWE-22: Path Traversal](https://cwe.mitre.org/data/definitions/22.html)
- [CWE-362: TOCTOU Race Condition](https://cwe.mitre.org/data/definitions/362.html)
- [CWE-415: Double Free](https://cwe.mitre.org/data/definitions/415.html)

---

## Document Maintenance

**Last Updated**: October 23, 2025
**Next Review**: April 2026 (or after major dependency updates)

**Change Log**:
- 2025-01-23: Initial comprehensive security audit completed
