# macOS AddressSanitizer and System Integrity Protection (SIP) Issue

## Problem

When running tests with AddressSanitizer (ASAN) on macOS, Jest worker processes fail with:

```
ERROR: Interceptors are not working. This may be because AddressSanitizer is loaded too late (e.g. via dlopen).
A jest worker process was terminated by another process: signal=SIGABRT, exitCode=null.
```

## Root Cause

macOS System Integrity Protection (SIP) strips `DYLD_*` environment variables (including `DYLD_INSERT_LIBRARIES`) from child processes for security reasons. Since Jest spawns worker processes to run tests in parallel, these workers don't inherit the ASAN library injection, causing them to abort.

## Verification

The native module works correctly with ASAN when called directly:

```bash
export DYLD_INSERT_LIBRARIES="/Library/Developer/CommandLineTools/usr/lib/clang/17/lib/darwin/libclang_rt.asan_osx_dynamic.dylib"
node -e "require('./build/Release/fs_metadata.node').getVolumeMountPoints().then(console.log)"
```

## Solutions

### 1. Run Tests in Single Process Mode (Recommended)

The easiest workaround is to run Jest in single-process mode:

```bash
npm test -- --runInBand --maxWorkers=1
```

This has been implemented in `scripts/macos-asan.sh`.

### 2. Static ASAN Linking (Alternative)

Instead of relying on dynamic library injection, link ASAN statically. However, this requires careful coordination with Node.js's build configuration.

### 3. Disable SIP (Not Recommended)

Temporarily disabling SIP allows DYLD_INSERT_LIBRARIES to work but compromises system security.

### 4. Use Linux for ASAN Testing

The Linux ASAN tests in CI don't have this limitation and can catch most memory issues.

## Current Implementation

The `scripts/macos-asan.sh` script now:

1. Builds with ASAN flags
2. Runs tests with `--runInBand` to avoid worker processes
3. Detects the "interceptors not installed" error and treats it as expected behavior
4. Falls back to the macOS `leaks` tool for additional memory checking
5. Provides clear messaging about the SIP limitation

The `scripts/check-memory.mjs` script:

1. Ensures a clean build before running JavaScript memory tests to avoid ASAN contamination
2. Clears ASAN environment variables when running tests
3. Treats macOS ASAN failures due to SIP as warnings, not errors
4. Still runs the `leaks` tool for native memory checking

## CI Considerations

- The GitHub Actions workflow runs ASAN tests on both Linux and macOS
- Linux ASAN tests are more reliable due to no SIP restrictions
- macOS ASAN failures due to SIP are treated as warnings, not CI failures
- macOS tests still provide value through the `leaks` tool and JavaScript memory tests
