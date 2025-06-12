# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is @photostructure/fs-metadata - a cross-platform native Node.js module for retrieving filesystem metadata, including mount points, volume information, and space utilization statistics.

### Key Features
- Cross-platform support: Windows 10+ (x64), macOS 14+, Ubuntu 22+ (x64, arm64)
- Lists all mounted volumes/drives
- Gets detailed volume metadata (size, usage, filesystem type, etc.)
- Hidden file/directory attribute support (get/set)
- Non-blocking async native implementations
- Timeout handling for unresponsive network volumes
- ESM and CJS module support
- Full TypeScript type definitions
- Worker threads support with proper context isolation

### Platform-Specific Notes
- **Linux**: Optional GIO/GVfs mount support via Gnome libraries
- **Windows**: Uses separate threads per mountpoint for health checks to handle blocked system calls
- **System Volumes**: Each platform handles system volumes differently; the library uses heuristics to identify them

## Architecture Overview

### Core Structure
- **Native binding layer** (`src/binding.cpp`): Node-API v9 bridge between JavaScript and platform-specific implementations
- **Platform abstractions** in `src/common/`: Shared C++ interfaces for cross-platform functionality
- **Platform implementations**:
  - `src/darwin/`: macOS-specific code using Core Foundation APIs
  - `src/linux/`: Linux-specific code with optional GIO support for GNOME/GVfs
  - `src/windows/`: Windows-specific code using Win32 APIs

### Key Features
- **Volume Metadata**: Retrieves filesystem information (mount points, disk usage, health status)
- **Hidden File Support**: Cross-platform hidden file detection and manipulation
- **Async Operations**: All native operations use Worker threads to avoid blocking

### Build System
- Uses `node-gyp` for native compilation
- Conditionally enables GIO support on Linux via `scripts/configure.mjs`
- Provides prebuilt binaries via `prebuildify` for common platforms
- Supports both ESM and CJS module formats

### Cross-Module Compatibility
- **Directory Path Resolution**: Use `_dirname()` from `./dirname` instead of `__dirname`
  - Works in both CommonJS and ESM contexts
  - Handles Jest test environments correctly
  - Example: `const dir = _dirname()` instead of `const dir = __dirname`

### Testing Strategy
- Jest for both CJS and ESM test suites
- Platform-specific test expectations handled via `isWindows`, `isMacOS`, `isLinux` helpers
- Memory leak testing with garbage collection monitoring
- Coverage thresholds: 80% for all metrics

### Testing File System Metadata
- **Important**: File system metadata like `available` space, `used` space, and other dynamic properties change continuously as other processes run on the machine
- Tests should **never** expect exact equality for these values between multiple calls
- **Do not** make range assertions (e.g., `available > 0` or `used < size`) because:
  - Files can be created or deleted between calls (potentially gigabytes)
  - The changes can be dramatic and unpredictable
- Instead, for dynamic metadata:
  - Only verify the value exists and has the correct type
  - Use `typeof result.available === 'number'` rather than range checks
  - Focus on testing static properties (e.g., `size`, `mountFrom`, `fstype`) for exact equality
  - Consider using snapshot testing only for stable properties

### Timeout Handling
- Default timeout for volume operations to handle unresponsive network mounts
- Windows uses separate threads per mountpoint for health checks
- Configurable via `Options` interface

### Debug Logging
- Enable with `NODE_DEBUG=fs-meta` or `NODE_DEBUG=photostructure:fs-metadata`
- Debug messages from both JavaScript and native code are sent to `stderr`
- Uses native Node.js debuglog for determining if logging is enabled

## Release Process

The project uses a vanilla npm/git release workflow with GPG signed commits for security:

### Prerequisites
- Repository secrets must be configured:
  - `NPM_TOKEN`: Authentication token for npm publishing
  - `GPG_PRIVATE_KEY`: ASCII-armored GPG private key for signing commits
  - `GPG_PASSPHRASE`: Passphrase for the GPG key (if applicable)

### Automated Release
1. Trigger via GitHub Actions workflow dispatch with version type (patch/minor/major)
2. Builds all prebuilds for supported platforms
3. Runs comprehensive test suite across platforms
4. Uses `npm version` to bump version and create signed git tags
5. Publishes to npm registry
6. Creates GitHub release with auto-generated notes
7. All commits and tags are GPG signed for verification

### Manual Release (if needed)
```bash
npm run prepare-release
git config commit.gpgsign true
npm version patch|minor|major
npm publish
git push origin main --follow-tags
```

## Example Usage

```typescript
import { getVolumeMountPoints, getVolumeMetadata } from "@photostructure/fs-metadata";

// List all mounted volumes
const mountPoints = await getVolumeMountPoints();
console.dir({ mountPoints });

// Get metadata for a specific volume
const volumeMetadata = await getVolumeMetadata(mountPoints[0]);
console.dir({ volumeMetadata });

// Check if a file is hidden
import { isHidden } from "@photostructure/fs-metadata";
const hidden = await isHidden("/path/to/file");
```

## CI/CD Test Reliability Guidelines

Based on analysis of recent test failures, here are critical patterns to avoid flaky tests:

### 1. Benchmark and Performance Tests
- **Problem**: "Cannot log after tests are done" errors in worker_threads.test.ts
- **Solution**: 
  - Always await all async operations before test completion
  - Use proper test lifecycle hooks (afterEach/afterAll) for cleanup
  - Avoid console.log in async contexts without proper synchronization
  - Consider using test.concurrent with explicit done() callbacks

### 2. Alpine Linux ARM64 Issues
- **Problem**: Tests timeout on emulated Alpine ARM64 environments
- **Solution**:
  - Skip process-spawning tests on Alpine ARM64 (`if (isAlpine && isARM64)`)
  - Use increased timeout multipliers (20x) for emulated environments
  - Detect emulation via `/proc/cpuinfo` or environment checks
  - Consider separate test suites for native vs emulated environments

### 3. Worker Thread Management
- **Problem**: Race conditions in concurrent worker operations
- **Solution**:
  - Implement proper worker pool management with size limits
  - Use Promise.allSettled() instead of Promise.all() for parallel operations
  - Add explicit cleanup in test teardown to terminate all workers
  - Set reasonable concurrency limits based on environment (CPU cores)

### 4. Timeout Test Reliability
- **Problem**: Timeout tests fail due to timing precision issues
- **Solution**:
  - Never use exact timing assertions (e.g., expect 100ms)
  - Use ranges with adequate margins (e.g., 90-110ms)
  - Account for CI environment variability (slower machines)
  - Consider mocking timers for deterministic behavior

### 5. File System Operations
- **Problem**: ENOENT errors for test directories, permission issues
- **Solution**:
  - Always use unique temporary directories per test
  - Clean up test artifacts in afterEach hooks
  - Check directory existence before operations
  - Handle platform-specific path separators

### 6. Memory and Resource Leaks
- **Problem**: Tests don't properly clean up resources
- **Solution**:
  - Explicitly close all file handles, network connections
  - Use try-finally blocks for resource cleanup
  - Monitor memory usage in long-running tests
  - Implement proper garbage collection triggers

### 7. Platform-Specific Failures
- **Problem**: Different behavior across Windows/macOS/Linux
- **Solution**:
  - Use platform detection helpers consistently
  - Skip platform-specific tests appropriately
  - Account for filesystem differences (case sensitivity, path formats)
  - Test with platform-specific CI matrices

### 8. Jest Configuration
- **Problem**: Tests interfere with each other
- **Solution**:
  - Use `--runInBand` for tests with shared resources
  - Clear module cache between tests when needed
  - Isolate tests that spawn processes
  - Configure proper test timeouts per environment

### Async Cleanup Anti-Patterns

**IMPORTANT**: The following approaches are NOT valid solutions for async cleanup issues:

```javascript
// BAD: Arbitrary timeouts in tests
await new Promise((resolve) => setTimeout(resolve, 100));

// BAD: Forcing garbage collection
if (global.gc) {
  global.gc();
}

// BAD: Adding setImmediate in afterAll to "fix" hanging tests
afterAll(async () => {
  await new Promise((resolve) => setImmediate(resolve));
});
```

**Why these are problematic:**

1. **Arbitrary timeouts** are race conditions waiting to happen. They might work on fast machines but fail on slower CI runners.
2. **Forcing GC** should never be required for correct behavior. If your code depends on GC for correctness, it has a fundamental design flaw.
3. **setImmediate/nextTick delays** in cleanup hooks don't fix the root cause - they just paper over the real issue.
4. These approaches mask the real problem instead of fixing it.

**Note**: This is different from legitimate uses of timeouts, such as:

- Waiting for time to pass to test timestamp changes
- Rate limiting or throttling tests
- Testing timeout behavior itself

The anti-pattern is using timeouts or GC to "fix" async cleanup issues.

**What to do instead:**

1. Find the actual resource that's keeping the process alive (use `--detectOpenHandles`)
2. Ensure all database connections are properly closed
3. Ensure all file handles are closed
4. Cancel or await all pending async operations
5. Use proper resource management patterns (RAII, try-finally, using statements)

### Windows-Compatible Directory Cleanup

**IMPORTANT**: Never use `fs.rmSync()` or `fs.rm()` without proper Windows retry logic for directory cleanup in tests.

**Problem**: On Windows, file handles and directory locks can remain active longer than on Unix systems, causing `EBUSY` errors during cleanup.

**Proper Solution**: Use `fsp.rm()` (async) with retry options:

```typescript
await fsp.rm(tempDir, {
  recursive: true,
  force: true,
  maxRetries: process.platform === "win32" ? 3 : 1,
  retryDelay: process.platform === "win32" ? 100 : 0,
});
```

**Best Practice**: Use existing test utilities that handle Windows-compatible cleanup patterns. Don't manually clean up temp directories - let the test framework handle it with proper retry logic.

### Adaptive Timeout Testing

**Problem**: Fixed timeouts don't account for varying CI environment performance.

**Root Causes**:

- Alpine Linux (musl libc) is 2x slower than glibc
- ARM64 emulation on x64 runners is 5x slower
- Windows process operations are 4x slower
- macOS VMs are 4x slower
- CI environments have resource constraints

**Solutions**:

```typescript
// DON'T: Use fixed timeouts
test("my test", async () => {
  // Test code
}, 10000);

// DO: Use adaptive timeouts based on environment
import { getTestTimeout } from "./test-utils/test-timeout-config";

test(
  "my test",
  async () => {
    // Test code
  },
  getTestTimeout(10000),
);

// DO: Account for platform timing differences
const timingMultiplier = process.platform === "win32" ? 4 :
                        process.platform === "darwin" ? 4 :
                        process.env.CI ? 2 : 1;
```

### Multi-Process Test Synchronization

**Problem**: Multi-process tests failing due to race conditions between process startup and test assertions.

**Root Cause**: The timing between process startup and resource acquisition varies significantly by platform.

**Solutions**:

```typescript
// DON'T: Assume immediate process readiness
const proc = spawn(nodeCmd, [script]);
const result = await waitForProcessResult(proc);
expect(result).toBe("expected_outcome"); // May fail due to timing

// DO: Use explicit synchronization signals
const script = `
  // Setup code
  console.log("READY");  // Signal readiness
  // Main test logic
  console.log("RESULT:" + outcome);
`;

const proc = spawn(process.execPath, ["-e", script]);
await waitForOutput(proc, "READY"); // Wait for process to be ready
const result = await waitForOutput(proc, "RESULT:");
expect(result.split(":")[1]).toBe("expected_outcome");
```

### Wait-for-Condition Pattern

**Problem**: Tests failing because they don't wait for asynchronous conditions to be met.

**Solution**: Implement robust condition waiting with platform-aware timing:

```typescript
async function waitForCondition(
  check: () => boolean | Promise<boolean>,
  options: {
    maxAttempts?: number;
    delay?: number;
    timeoutMs?: number;
  } = {}
) {
  const {
    maxAttempts = 50,
    delay = 100,
    timeoutMs = 30000
  } = options;
  
  const startTime = Date.now();
  
  for (let i = 0; i < maxAttempts; i++) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(`Condition not met within ${timeoutMs}ms`);
    }
    
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  
  return false;
}

// Usage example
await waitForCondition(
  () => fs.existsSync(expectedFile),
  { timeoutMs: getTestTimeout(10000) }
);
```

### Best Practices Summary
1. **Always clean up**: Resources, timers, workers, file handles
2. **Never assume timing**: Use ranges and adaptive timeouts, not exact values
3. **Isolate tests**: Each test should be independent
4. **Platform awareness**: Skip tests that can't work on certain platforms
5. **Proper async handling**: Always await or return promises
6. **Resource limits**: Don't spawn unlimited workers/processes
7. **Environment detection**: Adjust behavior for CI vs local
8. **Deterministic tests**: Mock external dependencies when possible
9. **Explicit synchronization**: Use signals for multi-process coordination
10. **Robust waiting**: Use condition-based waiting instead of arbitrary timeouts
11. **Windows compatibility**: Use retry logic for file operations on Windows
12. **Anti-pattern awareness**: Avoid masking problems with timeouts or forced GC