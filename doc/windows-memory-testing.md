# Windows Memory Testing

## Overview

On Windows, debug builds with CRT memory leak detection face a loading issue where Node.js cannot load native modules that use Windows long paths (`\\?\` prefix). This document describes our approach to memory leak detection on Windows.

## The Problem

When building with `node-gyp build --debug`, the debug build cannot be loaded by Node.js due to:

1. **Missing Debug Runtime Dependencies**: Debug builds require debug versions of the Visual C++ runtime libraries (`ucrtbased.dll`, `vcruntime*d.dll`)
2. **UNC Path Issues**: Node.js module loader has issues with Windows extended-length paths (`\\?\C:\...`)

## Our Solution

We've split Windows security testing into three categories:

### 1. Input Security Tests (`windows-input-security.test.ts`)

Tests for handling malicious inputs:

- Path traversal protection
- Buffer overflow protection
- Invalid UTF-8 handling
- Device name rejection
- Alternate data stream rejection

These tests run with regular Release builds and don't require debug memory detection.

### 2. Resource Security Tests (`windows-resource-security.test.ts`)

Tests for resource/handle leaks during operations:

- Concurrent operations safety
- Handle cleanup on timeout
- Basic memory pattern monitoring

These tests validate functionality with Release builds.

### 3. Memory Leak Detection (`windows-memory-check.test.ts`)

JavaScript-based memory monitoring that works with Release builds:

- Heap memory usage tracking with forced garbage collection
- Memory growth pattern analysis
- Handle count monitoring (via `process.report`)
- Per-operation memory cost calculation

## Alternative Windows Memory Leak Detection Tools

**Note: Traditional Windows memory debugging tools have significant compatibility issues with Node.js native modules.**

### Why These Tools Don't Work Well with Node.js

1. **Dr. Memory**: Known incompatibility with Node.js - fails with "Unable to load client library: ucrtbase.dll" error (GitHub issue #2531)
2. **Visual Leak Detector (VLD)**: Requires debug builds which have loading issues with Node.js native modules
3. **Application Verifier**: Cannot properly hook into Node.js's memory management system
4. **Windows CRT Debug Heap**: Requires debug builds that face the UNC path loading issue

### Our Approach

Instead of these traditional tools, we use:

- JavaScript-based memory monitoring with forced garbage collection
- Process handle tracking via Node.js's built-in `process.report`
- Heap usage patterns analysis over multiple iterations
- This approach provides adequate memory leak detection without the compatibility issues

## Running Memory Tests

```bash
# Run all memory tests (JavaScript-based)
npm test -- src/windows-memory-check.test.ts

# Run resource security tests
npm test -- src/windows-resource-security.test.ts

# Run input security tests
npm test -- src/windows-input-security.test.ts

# Run full memory check suite (includes debug build attempt)
npm run check:memory
```

## Key Metrics Monitored

1. **Heap Memory Growth**: Should be < 100KB per operation (Windows APIs may have higher baseline)
2. **Total Memory Retention**: Should be < 5MB after GC
3. **Handle Count**: Should not increase by more than 10
4. **Concurrent Operation Memory**: Should be < 10MB for 100 operations

## Future Improvements

1. Investigate fixing debug build loading:
   - Ship debug CRT dependencies
   - Use manifest embedding for dependency resolution
   - Investigate short path alternatives to avoid UNC paths

2. Enhanced JavaScript monitoring:
   - Native memory tracking via N-API
   - V8 heap snapshots comparison
   - Event loop lag correlation
   - Windows performance counters integration

3. Native-level monitoring:
   - Custom memory allocator wrappers
   - Direct Windows API handle tracking
   - Integration with Node.js's built-in diagnostics
