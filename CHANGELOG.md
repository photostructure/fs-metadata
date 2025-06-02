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

## [0.5.0] - 2025-06-01

### Added

- Comprehensive memory testing framework with Valgrind and AddressSanitizer support
- Thread safety tests for Windows platform
- Platform-specific build scripts with automatic OS detection
- Clang-tidy integration for C++ code analysis

### Breaking

- Dropped support for Node.js v18, added support for Node.js v24

### Changed

- Simplified ESM/CJS dual module support with unified build configuration
- Enhanced test coverage with additional error handling and edge case tests
- Updated all imports to use `node:` prefix for built-in modules

### Fixed

- Added path validation to prevent directory traversal vulnerabilities in hidden file operations
- Improved error handling and null checks across Linux GIO implementation
- Fixed buffer allocation issues in Windows networking and volume operations
- Enhanced resource management with better validation for empty mount points
- Made `SystemPathPatternsDefault` values visible in TypeScript typings
- Improved test reliability across different CI environments

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
