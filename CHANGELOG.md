# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
Added for new features.
Changed for changes in existing functionality.
Deprecated for soon-to-be removed features.
Removed for now removed features.
Fixed for any bug fixes.
Security in case of vulnerabilities.
-->

## 0.8.0 - 2025-12-01

### Security

- Fixed TOCTOU race condition in macOS hidden file operations by using `fstat()`/`fchflags()` with file descriptors instead of path-based `stat()`/`chflags()`

### Fixed

- Added `O_CLOEXEC` flag to `open()` calls to prevent fd leaks on fork/exec
- Fixed logic bug attempting to convert invalid CFStringRef in `ProcessNetworkVolume`
- Fixed inconsistent `status` field when DiskArbitration returns partial results
- Added `noexcept` to all RAII destructors to prevent `std::terminate` during stack unwinding
- Fixed `g_volume_monitor_get()` memory leak in Linux GIO metadata enrichment
- Fixed exception safety in Linux GIO metadata loop using RAII smart pointers
- Fixed Windows `FindFirstFileEx` handle leak by using `FindClose` instead of `CloseHandle`
- Fixed Windows promise race condition and resource leak from detached timeout threads
- Added `CreateEvent` error checking in Windows thread pool
- Zero-initialized `VolumeInfo` and `DiskSpaceInfo` members to prevent undefined behavior on `ERROR_NOT_READY`

### Changed

- Extracted shared `FdGuard` RAII class to `common/fd_guard.h`
- Extracted shared `WouldOverflow()` utility to `common/volume_utils.h`
- Moved `path_security.h` to `common/` (POSIX-portable)
- Simplified CFString null-terminator handling using `strlen()`
- Documented intentional static dispatch queue singleton pattern
- Consolidated Linux GIO RAII helpers (`GFilePtr`, `GVolumePtr`, etc.) in `gio_utils.h`
- Added move semantics to `BlkidCache` for proper resource transfer

## 0.7.1 - 2025-10-29

- Audit and address [several resource handling issues](./doc/SECURITY_AUDIT_2025.md)
- Added support for Node.js v25
- Updated dev dependencies

## 0.6.0 - 2025-06-09

### Added

- Comprehensive memory testing framework with Valgrind and AddressSanitizer support
- Thread safety tests for Windows platform
- Platform-specific build scripts with automatic OS detection
- Clang-tidy integration for C++ code analysis
- Worker thread helper for volume metadata operations
- NAPI_VERSION=9 definition for improved compatibility
- Dynamic test timeout configuration based on environment (CI, platform, architecture)
- Prebuild script for Linux GLIBC compatibility in Docker environments

### Breaking

- Dropped support for Node.js v18, added support for Node.js v24

### Changed

- Simplified ESM/CJS dual module support with unified build configuration
- Enhanced test coverage with additional error handling and edge case tests
- Updated all imports to use `node:` prefix for built-in modules
- Reorganized build and test scripts for better clarity
- Improved memory test workflow for cross-platform compatibility
- Renamed native module target from `node_fs_meta` to `fs_metadata` for consistency

### Fixed

- Added path validation to prevent directory traversal vulnerabilities in hidden file operations
- Improved error handling and null checks across Linux GIO implementation
- Fixed buffer allocation issues in Windows networking and volume operations
- Enhanced resource management with better validation for empty mount points
- Made `SystemPathPatternsDefault` values visible in TypeScript typings
- Added Napi::HandleScope to OnOK and OnError methods for proper scope management
- Removed unnecessary std::move operations in worker implementations
- Resolved CI test reliability issues across different environments, particularly Alpine ARM64 emulation timeouts

## [0.4.0] - 2025-01-09

- `Fixed`: Switch to thread-safe `getmntinfo_r_np()` for macOS. Improved darwin resource management.

## [0.3.3] - 2025-01-08

- `Packaging`: Improved ESM/CJS support with common `__dirname` implementation thanks to `tsup` [shims](https://tsup.egoist.dev/#inject-cjs-and-esm-shims).

  This change simplifies the implementation and improves inline jsdocs as the exported code and docs have been inlined.

- `Packaging`: Re-enabled test coverage assertions (after finding the magicks to get istanbul to see what the tests were exercising)

- `Packaging`: Added debuglog tests

- `Packaging`: Fixed `npm run watch`

## [0.3.2] - 2025-01-03

- `Fixed`: prior `canReaddir()` (and subsequent `status` of volume metadata) would incorrectly fail if the first directory element wasn't readable.

## [0.3.1] - 2025-01-03

No public codepath updates.

- `Fixed`: updated regex patterns for improved matching and linting compliance

- `Fixed`: flaky CI test on macOS

- `Added`: GitHub Action CodeQL and addressed linting nits

- `Added`: scripts for **manually** running `clang-tidy` and `snyk code test` (as they both emit spurious warnings that don't seem to be safely silenced)

## [0.3.0] - 2025-01-01

- `Changed`: For consistency, [Options.systemFsTypes](https://photostructure.github.io/fs-metadata/interfaces/Options.html#systemfstypes) is now a `string[]` (it was a `Set<string>`)

## [0.2.0] - 2025-01-01

- `Changed`: Add `**/#snapshot` to the list of "system" volumes

- `Changed`: Add sourcemaps and source typescript to the npm pack

- `Fixed`: macOS system mount points are now filtered properly

## [0.1.0] - 2024-12-17

First release! Everything is a new feature!

The 1.0.0 release will happen after some integration testing with the native
library payloads, but the API should be stable after the first release.
