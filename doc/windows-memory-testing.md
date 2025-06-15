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

For deeper memory analysis, consider these Windows-specific tools:

### Visual Leak Detector (VLD)
- Free, open-source memory leak detector
- Integrates with Visual Studio
- Provides complete stack traces for leaks
- Add to project: `#include <vld.h>` in C++ code

### Dr. Memory
- Cross-platform memory monitoring tool
- Detects uninitialized memory access, buffer overflows, leaks
- Works with release builds
- Command line: `drmemory -- your_app.exe`

### Application Verifier
- Built into Windows SDK
- Detects heap corruption, handle leaks, critical section issues
- UI and command-line interfaces
- Enable via: `appverif -enable Heaps -for your_app.exe`

### Windows CRT Debug Heap (when it works)
When debug builds can be loaded, the CRT provides:
- `_CrtSetDbgFlag(_CRTDBG_ALLOC_MEM_DF | _CRTDBG_LEAK_CHECK_DF)`
- Memory leak reports on process exit
- Allocation tracking with file/line information

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

2. Integration with external tools:
   - Automated VLD integration for CI
   - Dr. Memory in GitHub Actions
   - Performance counters monitoring

3. Enhanced JavaScript monitoring:
   - Native memory tracking via N-API
   - V8 heap snapshots comparison
   - Event loop lag correlation