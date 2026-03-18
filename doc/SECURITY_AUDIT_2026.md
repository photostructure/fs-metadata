# Security Audit Report - March 17, 2026

**Project**: @photostructure/fs-metadata
**Auditor**: Claude (Anthropic)
**Scope**: Complete codebase review including API verification against official documentation
**Previous Audit**: October-December 2025 (see `doc/SECURITY_AUDIT_2025.md`)

## Executive Summary

This audit covers all changes since the December 2025 re-audit, focusing on the new
macOS system volume detection system (APFS volume roles via IOKit/DiskArbitration),
the `isReadOnly`/`volumeRole`/`isSystemVolume` fields added to both C++ structs and
TypeScript interfaces, and updated TypeScript heuristics for container runtimes.

**Overall Security Rating: A (Excellent)** _(All findings resolved during this audit)_

### Codebase Reviewed

- 27 C++ files (11 headers, 16 source files) across `src/common/`, `src/darwin/`, `src/windows/`, `src/linux/`
- ~30 TypeScript source files, 43 test files
- `binding.gyp` build configuration

### Key Changes Since December 2025

1. **New**: macOS APFS volume role detection via IOKit (`system_volume.h`)
2. **New**: `ClassifyMacVolume()` combining `MNT_SNAPSHOT` + `MNT_DONTBROWSE` + APFS roles
3. **New**: `isReadOnly`, `volumeRole` fields on `MountPoint` and `VolumeMetadata`
4. **Updated**: `DASessionRAII` usage in both `volume_metadata.cpp` and `volume_mount_points.cpp`
5. **Updated**: TypeScript system path patterns expanded for container runtimes
6. **Updated**: `assignSystemVolume()` never downgrades native `isSystemVolume=true`

### Strengths (Carried Forward)

- ✅ Comprehensive RAII patterns on all platforms
- ✅ Path validation with `realpath()` (POSIX) and `PathCchCanonicalizeEx` (Windows)
- ✅ Null byte injection and directory traversal prevention at both C++ and TypeScript layers
- ✅ Integer overflow protection in volume size calculations
- ✅ File descriptor-based operations preventing TOCTOU
- ✅ Strong compiler security flags on all platforms
- ✅ No unsafe C functions (`strcpy`, `sprintf`, `gets`, etc.)
- ✅ CodeQL, Snyk, and ESLint security plugin in CI

---

## Findings

### Finding #1: IOKit Objects Not RAII-Wrapped in GetApfsVolumeRole() ✅ FIXED

**Severity**: 🟡 MEDIUM → ✅ RESOLVED
**CWE**: [CWE-404](https://cwe.mitre.org/data/definitions/404.html) (Improper Resource Shutdown or Release)
**File**: `src/darwin/system_volume.h` (lines 50-94)

**Issue**: `io_service_t media` and `io_registry_entry_t parent` were raw IOKit handles
released manually with `IOObjectRelease()`. If `std::string` construction or any other
operation between acquisition and release threw a C++ exception (e.g., `std::bad_alloc`),
`IOObjectRelease()` would never be called, leaking Mach port resources.

The `CFReleaser<CFArrayRef>` for `role` in the same function was already correctly
RAII-wrapped, making this an inconsistency.

**Fix Applied**:

Created `IOObjectGuard` in `src/darwin/raii_utils.h` — a RAII wrapper for `io_object_t`
following the same pattern as `CFReleaser`:

```cpp
class IOObjectGuard {
  io_object_t obj_;
public:
  explicit IOObjectGuard(io_object_t obj = 0) noexcept : obj_(obj) {}
  ~IOObjectGuard() noexcept { if (obj_) IOObjectRelease(obj_); }
  // non-copyable, movable
};
```

Updated `GetApfsVolumeRole()` to use `IOObjectGuard` for both `media` and `parent`.

**API Verification**:

- [`DADiskCopyIOMedia()`](<https://developer.apple.com/documentation/diskarbitration/dadiskcopymedia(_:)>) — Returns `io_service_t`; caller owns the reference
- [`IORegistryEntryGetParentEntry()`](https://developer.apple.com/documentation/iokit/1514761-ioregistryentrygetparententry) — Output `io_registry_entry_t`; caller owns the reference
- [`IOObjectRelease()`](https://developer.apple.com/documentation/iokit/1514627-ioobjectrelease) — Must be called once per owned reference

---

### Finding #2: Missing Mutex for DiskArbitration in volume_mount_points.cpp ✅ FIXED

**Severity**: 🟡 MEDIUM → ✅ RESOLVED
**CWE**: [CWE-362](https://cwe.mitre.org/data/definitions/362.html) (Concurrent Execution using Shared Resource with Improper Synchronization)
**File**: `src/darwin/volume_mount_points.cpp` (lines 53-88)

**Issue**: The October 2025 audit (Finding #5) established that DA operations must be
serialized via `g_diskArbitrationMutex`. `volume_metadata.cpp` correctly held this mutex
before any DA calls. However, `volume_mount_points.cpp` — added later as part of the
system volume detection feature — created its own `DASessionRAII` and called
`ClassifyMacVolume()` **without any mutex protection**.

When `getVolumeMountPoints()` and `getVolumeMetadata()` are called concurrently from
JavaScript, two AsyncWorker threads could perform DA + IOKit operations simultaneously,
which Apple's documentation does not explicitly guarantee is safe.

**Fix Applied**:

1. Created `src/darwin/da_mutex.h` — shared header declaring `extern std::mutex g_diskArbitrationMutex`
2. Changed `volume_metadata.cpp`'s definition from `static` to `extern`-compatible
3. Updated `volume_mount_points.cpp` to:
   - Include `da_mutex.h`
   - Perform all DA/IOKit classification under `std::lock_guard<std::mutex>` **before** launching async accessibility checks
   - Release the mutex before the potentially-slow `faccessat()` calls
4. Restructured the batching loop so DA operations are fully separated from I/O checks

**Design Decision**: All DA + IOKit operations are now batched into a single mutex-protected
block at the start, rather than interleaved with `faccessat()` checks. This minimizes
mutex hold time while ensuring complete serialization of framework calls.

---

### Finding #3: Uninitialized `double` Members in VolumeMetadata Struct ✅ FIXED

**Severity**: 🟡 MEDIUM → ✅ RESOLVED
**CWE**: [CWE-457](https://cwe.mitre.org/data/definitions/457.html) (Use of Uninitialized Variable)
**File**: `src/common/volume_metadata.h` (lines 43-45)

**Issue**: The `size`, `used`, and `available` fields were uninitialized:

```cpp
double size;      // NO INITIALIZER
double used;      // NO INITIALIZER
double available; // NO INITIALIZER
```

Other members in the same struct had default initializers (`bool remote = false;`,
`bool isSystemVolume = false;`). If `GetBasicVolumeInfo()` failed early or a Windows
drive was not `Healthy`, `MetadataWorkerBase::OnOK()` would still call `ToObject()`,
serializing uninitialized garbage values to JavaScript.

**Fix Applied**:

```cpp
double size = 0.0;
double used = 0.0;
double available = 0.0;
```

---

### Finding #4: `strerror()` Thread Safety (Informational)

**Severity**: 🟢 LOW → NO ACTION NEEDED
**CWE**: [CWE-362](https://cwe.mitre.org/data/definitions/362.html) (Race Condition)
**File**: `src/common/error_utils.h` (lines 25, 32)

**Issue**: `strerror()` is not guaranteed thread-safe by POSIX (it may return a pointer
to a static buffer). Used in `CreatePathErrorMessage()` and `CreateDetailedErrorMessage()`,
called from AsyncWorker threads.

**Assessment**: No fix needed at this time.

- glibc's `strerror()` is thread-safe (uses thread-local buffer)
- Apple's `strerror()` is also thread-safe
- These are the only two POSIX platforms this project supports
- The code already follows best practice: capturing `errno` immediately into a local `int error` variable, then calling `strerror(error)` (not `strerror(errno)`)

**Recommendation**: If Alpine Linux (musl libc) support is added, verify `strerror()` thread safety or switch to `strerror_r()`.

---

### Finding #5: `compileGlob()` Pattern Complexity (Informational)

**Severity**: 🟢 LOW → NO ACTION NEEDED
**File**: `src/glob.ts`

**Issue**: `compileGlob()` compiles user-provided `systemPathPatterns` into a `RegExp`.
A caller could theoretically provide a malicious pattern causing ReDoS.

**Assessment**: No fix needed.

- The glob-to-regex translation produces simple patterns (no nested quantifiers)
- Patterns are matched against mount point paths (short, bounded-length strings)
- The cache is bounded to 256 entries
- Default patterns are hardcoded constants (`SystemPathPatternsDefault`)
- This is a library consumed by application code, not a web-facing API

---

### Finding #6: Redundant `GetVolumeInformationW` Calls (Windows, Efficiency) ✅ FIXED

**Severity**: 🟢 LOW → ✅ RESOLVED
**CWE**: N/A (efficiency, not security)
**Files**: `src/windows/volume_mount_points.cpp`, `src/windows/volume_metadata.cpp`, `src/windows/system_volume.h`

**Issue**: `GetVolumeInformationW` was called redundantly:
- In `volume_mount_points.cpp`: once for `fstype`/`isReadOnly`, then again inside `IsSystemVolume()`
- In `volume_metadata.cpp`: `IsSystemVolume()` queried the API, then `VolumeInfo` queried it again 5 lines later

**Fix Applied**:

1. Added `volumeFlags` parameter to `IsSystemVolume()` (default `0` for backward compat)
2. When `volumeFlags != 0`, skips the redundant `GetVolumeInformationW` call
3. `volume_mount_points.cpp`: passes pre-fetched `fsFlags` to `IsSystemVolume()`, and
   moves the `IsSystemVolume` call inside the healthy-drive block to prevent querying
   dead drives (which would hang the worker thread, defeating async timeout protection)
4. `volume_metadata.cpp`: reordered to create `VolumeInfo` first, then pass its flags
   to `IsSystemVolume()` — eliminates the duplicate query

---

## Re-Verification of October-December 2025 Audit Findings

| #   | Finding                                 | Severity | Status                               | Verification                                                                                                                                                       |
| --- | --------------------------------------- | -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Path Validation Bypass                  | CRITICAL | ✅ STILL FIXED                       | `ValidatePathForRead()` with `realpath()` confirmed in `darwin/volume_metadata.cpp:82-87` and `linux/volume_metadata.cpp:41-45`. `path_security.h` unchanged.      |
| 2   | Windows Path Length                     | CRITICAL | ✅ STILL FIXED                       | `PathCchCanonicalizeEx` with `PATHCCH_ALLOW_LONG_PATHS` in `security_utils.h:112-115`.                                                                             |
| 3   | Integer Overflow in String Conversion   | CRITICAL | ✅ STILL FIXED                       | `SafeStringToWide` with `MB_ERR_INVALID_CHARS` in `security_utils.h:155-168`. `WideToUtf8` with `INT_MAX`/`MAX_STRING_CONVERSION_SIZE` checks in `string.h:35-40`. |
| 4   | Memory Leak in Windows Error Formatting | HIGH     | ✅ STILL FIXED                       | `LocalFreeGuard` in `windows/error_utils.h`.                                                                                                                       |
| 5   | DiskArbitration Threading               | HIGH     | ⚠️ PARTIALLY REGRESSED → ✅ RE-FIXED | `volume_metadata.cpp` still used the mutex. New `volume_mount_points.cpp` did not. Fixed in Finding #2 above with shared `da_mutex.h`.                             |
| 6   | GVolumeMonitor Thread Safety (Linux)    | HIGH     | ✅ STILL FIXED                       | `g_unix_mounts_get()` approach unchanged.                                                                                                                          |
| 7   | Double-Free in GIO (Linux)              | HIGH     | ✅ STILL FIXED                       | `GUnixMountEntry` approach unchanged.                                                                                                                              |
| 8   | CFStringGetCString Error Logging        | MEDIUM   | ✅ STILL FIXED                       | Debug logging in `volume_metadata.cpp:54-58`.                                                                                                                      |
| 9   | TOCTOU Race Condition                   | MEDIUM   | ✅ STILL FIXED                       | `open()` + `fstatvfs(fd)` pattern in both darwin and linux `volume_metadata.cpp`.                                                                                  |
| 10  | blkid Memory Management                 | MEDIUM   | ✅ STILL FIXED                       | `free()` with documentation in `linux/volume_metadata.cpp:134-156`.                                                                                                |
| 11  | Thread Pool Timeout                     | LOW      | ✅ STILL ACCEPTABLE                  | No changes.                                                                                                                                                        |
| 12  | ARM64 Security Flags                    | LOW      | ✅ STILL DOCUMENTED                  | `binding.gyp` inline comments and `doc/WINDOWS_ARM64_SECURITY.md`.                                                                                                 |

---

## New API Verification Matrix

All new API calls introduced since the December 2025 audit:

| API                                 | Platform | Usage Location                       | Documentation                                                                                                                                    | Status                         |
| ----------------------------------- | -------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `DADiskCopyIOMedia()`               | macOS    | `system_volume.h:50`                 | [Apple](<https://developer.apple.com/documentation/diskarbitration/dadiskcopymedia(_:)>)                                                         | ✅ Now RAII-wrapped            |
| `IORegistryEntryCreateCFProperty()` | macOS    | `system_volume.h:58,68`              | [Apple](https://developer.apple.com/documentation/iokit/1514342-ioregistryentrycreatecfproperty)                                                 | ✅ Wrapped in `CFReleaser`     |
| `IORegistryEntryGetParentEntry()`   | macOS    | `system_volume.h:66`                 | [Apple](https://developer.apple.com/documentation/iokit/1514761-ioregistryentrygetparententry)                                                   | ✅ Now RAII-wrapped            |
| `IOObjectRelease()`                 | macOS    | `raii_utils.h` (via `IOObjectGuard`) | [Apple](https://developer.apple.com/documentation/iokit/1514627-ioobjectrelease)                                                                 | ✅ RAII destructor             |
| `CFArrayGetCount()`                 | macOS    | `system_volume.h:75`                 | [Apple](https://developer.apple.com/documentation/corefoundation/1388772-cfarraygetcount)                                                        | ✅ Bounds-checked              |
| `CFArrayGetValueAtIndex()`          | macOS    | `system_volume.h:78`                 | [Apple](https://developer.apple.com/documentation/corefoundation/1388767-cfarraygetvalueatindex)                                                 | ✅ Index validated (count > 0) |
| `CFGetTypeID()`                     | macOS    | `system_volume.h:74,79`              | [Apple](https://developer.apple.com/documentation/corefoundation/1521218-cfgettypeid)                                                            | ✅ Type-checked before cast    |
| `getmntinfo_r_np()`                 | macOS    | `volume_mount_points.cpp:40`         | `man getmntinfo_r_np`                                                                                                                            | ✅ Thread-safe, RAII buffer    |
| `SHGetFolderPathW()`                | Windows  | `system_volume.h:24`                 | [Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shgetfolderpathw)                                     | ✅ HRESULT checked             |
| `_wcsnicmp()`                       | Windows  | `system_volume.h:29`                 | [Microsoft](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/strnicmp-wcsnicmp-mbsnicmp-strnicmp-l-wcsnicmp-l-mbsnicmp-l)       | ✅ Compares 2 chars only       |
| `wcsncpy_s()`                       | Windows  | `system_volume.h:26`                 | [Microsoft](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/strncpy-s-strncpy-s-l-wcsncpy-s-wcsncpy-s-l-mbsncpy-s-mbsncpy-s-l) | ✅ 3 chars into WCHAR[4]       |

---

## Memory Safety Summary

### RAII Coverage (All Resource Types)

| Resource Type                | RAII Wrapper                  | Platform    | Status                  |
| ---------------------------- | ----------------------------- | ----------- | ----------------------- |
| CoreFoundation objects       | `CFReleaser<T>`               | macOS       | ✅ Complete             |
| IOKit objects                | `IOObjectGuard`               | macOS       | ✅ **NEW** (this audit) |
| DASession + dispatch queue   | `DASessionRAII`               | macOS       | ✅ Complete             |
| `getmntinfo_r_np()` buffer   | `MountBufferRAII`             | macOS       | ✅ Complete             |
| `malloc()`-allocated buffers | `ResourceRAII<T>`             | macOS       | ✅ Complete             |
| POSIX file descriptors       | `FdGuard`                     | macOS/Linux | ✅ Complete             |
| Windows `HANDLE`             | `HandleGuard`                 | Windows     | ✅ Complete             |
| `FindFirstFile` handles      | `FindHandleGuard`             | Windows     | ✅ Complete             |
| `CRITICAL_SECTION`           | `CriticalSectionGuard`        | Windows     | ✅ Complete             |
| `FormatMessageA` buffer      | `LocalFreeGuard`              | Windows     | ✅ Complete             |
| `WNetGetConnection` buffer   | `WNetConnection` (unique_ptr) | Windows     | ✅ Complete             |
| GObject/GFree                | `GObjectPtr<T>`, `GCharPtr`   | Linux       | ✅ Complete             |
| blkid cache                  | `BlkidCache`                  | Linux       | ✅ Complete             |

### Unsafe Function Audit

No unsafe C functions found:

- ❌ No `strcpy`, `strcat`, `sprintf`, `gets`, `scanf`
- ❌ No `memcpy` with untrusted sizes
- ❌ No unvalidated buffer operations
- ✅ `std::string` used throughout for dynamic strings
- ✅ `CFStringGetCString` with explicit buffer size
- ✅ `wcsncpy_s` (Windows secure variant) with size parameter

---

## Compiler Security Flags Verification

| Flag                   | macOS                      | Linux x64                  | Linux ARM64                    | Windows x64      | Windows ARM64  |
| ---------------------- | -------------------------- | -------------------------- | ------------------------------ | ---------------- | -------------- |
| Stack Protector        | `-fstack-protector-strong` | `-fstack-protector-strong` | `-fstack-protector-strong`     | `/sdl`           | `/sdl`         |
| Source Fortification   | `-D_FORTIFY_SOURCE=2`      | `-D_FORTIFY_SOURCE=2`      | `-D_FORTIFY_SOURCE=2`          | N/A              | N/A            |
| Format Security        | `-Wformat-security`        | `-Wformat-security`        | `-Wformat-security`            | N/A              | N/A            |
| Control Flow Integrity | N/A                        | `-fcf-protection=full`     | `-mbranch-protection=standard` | `/guard:cf`      | `/guard:cf`    |
| Spectre Mitigation     | N/A                        | N/A                        | N/A                            | `/Qspectre`      | N/A (HW)       |
| ASLR                   | default                    | default                    | default                        | `/DYNAMICBASE`   | `/DYNAMICBASE` |
| DEP                    | default                    | default                    | default                        | `/NXCOMPAT`      | `/NXCOMPAT`    |
| High Entropy ASLR      | default                    | default                    | default                        | `/HIGHENTROPYVA` | N/A            |
| CET/Shadow Stack       | N/A                        | N/A                        | N/A                            | `/CETCOMPAT`     | N/A (BTI)      |

---

## Thread Safety Summary

| Mechanism                               | Location                                         | Protects                                                               |
| --------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `g_diskArbitrationMutex`                | `da_mutex.h` (shared)                            | All DA + IOKit operations across both metadata and mount point workers |
| `DASessionRAII` + serial dispatch queue | `volume_metadata.cpp`, `volume_mount_points.cpp` | DA session lifecycle (unschedule-before-release)                       |
| `BlkidCache::mutex_`                    | `blkid_cache.h`                                  | blkid cache operations                                                 |
| `CRITICAL_SECTION`                      | `thread_pool.h`, `drive_status.h`                | Windows thread pool task queue                                         |
| `Napi::AsyncWorker`                     | All worker classes                               | V8 isolate access (N-API guarantee)                                    |
| `std::async` + `std::future`            | `volume_mount_points.cpp`                        | Timeout-aware concurrent `faccessat()` checks                          |

---

## Testing Summary

- **Test Suite**: 503 tests passed, 55 platform-specific skipped (558 total)
- **macOS Concurrent Tests**: 100 rapid DA requests (`darwin-disk-arbitration-threading.test.ts`)
- **Cross-API Concurrent Tests**: Interleaved `getVolumeMountPoints()` + `getVolumeMetadata()` calls
- **System Volume Detection**: Validated on macOS (`/` = MNT_SNAPSHOT, `/System/Volumes/VM` = APFS role)
- **Error Handling**: Invalid paths, null inputs, non-existent paths, empty strings

### Recommended Future Testing

- ThreadSanitizer build on macOS/Linux for runtime data race detection
- AddressSanitizer build for memory safety regression testing
- Cross-API stress test combining `getVolumeMountPoints()` + `getVolumeMetadata()` + `isHidden()` concurrently

---

## References

### Official Documentation Sources

- **Windows APIs**: [Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/)
- **macOS APIs**: [Apple Developer Documentation](https://developer.apple.com/documentation/)
- **IOKit**: [IOKit Framework Reference](https://developer.apple.com/documentation/iokit)
- **DiskArbitration**: [DiskArbitration Framework](https://developer.apple.com/documentation/diskarbitration)
- **Linux System Calls**: [man7.org](https://man7.org/linux/man-pages/)
- **GIO/GLib**: [GNOME Developer](https://developer.gnome.org/)
- **libblkid**: [util-linux GitHub](https://github.com/util-linux/util-linux)

### Security Resources

- [CWE-362: Race Condition](https://cwe.mitre.org/data/definitions/362.html)
- [CWE-404: Improper Resource Shutdown or Release](https://cwe.mitre.org/data/definitions/404.html)
- [CWE-457: Use of Uninitialized Variable](https://cwe.mitre.org/data/definitions/457.html)
- [Apple Secure Coding Guide: Race Conditions](https://developer.apple.com/library/archive/documentation/Security/Conceptual/SecureCodingGuide/Articles/RaceConditions.html)

---

## Document Maintenance

**Created**: March 17, 2026
**Next Review**: September 2026 (or after major dependency updates)

**Change Log**:

- 2026-03-17: Initial audit
  - 6 findings identified (3 medium, 3 low)
  - 4 findings fixed during audit (Findings #1, #2, #3, #6)
  - 2 findings assessed as acceptable (Findings #4, #5)
  - All 12 findings from October 2025 audit re-verified
  - Finding #5 from 2025 (DA threading) found partially regressed in new code, re-fixed
  - Created `IOObjectGuard` RAII wrapper for IOKit objects
  - Created `da_mutex.h` for shared DA mutex across translation units
  - Test suite: 503 tests passing (55 platform-specific skipped)
