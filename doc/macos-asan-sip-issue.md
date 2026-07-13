# macOS AddressSanitizer and System Integrity Protection (SIP)

## Problem

When running tests with AddressSanitizer (ASAN) on macOS, Jest worker processes fail with:

```
ERROR: Interceptors are not working. This may be because AddressSanitizer is loaded too late (e.g. via dlopen).
A jest worker process was terminated by another process: signal=SIGABRT, exitCode=null.
```

## Root Cause

macOS System Integrity Protection (SIP) strips `DYLD_*` environment variables (including
`DYLD_INSERT_LIBRARIES`) when a protected executable is launched. A package-manager shim with a
`#!/usr/bin/env node` shebang takes a protected `/usr/bin/env` hop and can lose the ASan runtime
before Node starts.

## Verification

The native module works correctly with ASAN when called directly:

```bash
export DYLD_INSERT_LIBRARIES="/Library/Developer/CommandLineTools/usr/lib/clang/17/lib/darwin/libclang_rt.asan_osx_dynamic.dylib"
node -e "require('./build/Release/fs_metadata.node').getVolumeMountPoints().then(console.log)"
```

## Solutions

### 1. Run Tests in Single Process Mode (Recommended)

Run Jest in single-process mode and invoke its JavaScript entry point with the setup-node binary
directly:

```bash
node node_modules/jest/bin/jest.js --runInBand
```

This has been implemented in `scripts/macos-asan.sh`.

### 2. Static ASAN Linking (Alternative)

Instead of relying on dynamic library injection, link ASAN statically. However, this requires careful coordination with Node.js's build configuration.

### 3. Disable SIP (Not Recommended)

Temporarily disabling SIP allows DYLD_INSERT_LIBRARIES to work but compromises system security.

### 4. Use Linux for ASAN Testing

The Linux ASAN tests in CI don't have this limitation and can catch most memory issues.

## Current Implementation

The `scripts/macos-asan.sh` script:

1. Builds with ASan and UBSan instrumentation
2. Resolves the matching runtime from Apple clang and proves that Node loaded it
3. Invokes Jest's JavaScript entry point directly with `--runInBand`
4. Treats interceptor startup failures, sanitizer reports, and test failures as gating errors
5. Rebuilds without sanitizer instrumentation, then runs a checked-in TypeScript workload under
   the macOS `leaks` tool; leaks and tool failures are gating errors

The `scripts/check-memory.ts` script:

1. Runs JavaScript memory tests before platform-native checks
2. Invokes the macOS ASAN script
3. Propagates every build, test, leak-tool, or sanitizer failure to CI

## CI Considerations

- The GitHub Actions workflow runs ASAN tests on Linux x64/ARM64 and macOS
- Linux ASAN tests are more reliable due to no SIP restrictions
- A macOS run that cannot load the ASan runtime fails rather than silently passing
- macOS also gates on the `leaks` tool and JavaScript memory tests
