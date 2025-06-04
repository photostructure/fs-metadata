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