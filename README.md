![PhotoStructure fs-metadata logo](https://raw.githubusercontent.com/photostructure/fs-metadata/main/doc/logo.svg)

A cross-platform native Node.js module for retrieving filesystem metadata, including mount points, volume information, and space utilization statistics.

Built and supported by [PhotoStructure](https://photostructure.com).

[![npm version](https://img.shields.io/npm/v/@photostructure/fs-metadata.svg)](https://www.npmjs.com/package/@photostructure/fs-metadata)
[![Build](https://github.com/photostructure/fs-metadata/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/photostructure/fs-metadata/actions/workflows/build.yml)
[![GitHub issues](https://img.shields.io/github/issues/photostructure/fs-metadata.svg)](https://github.com/photostructure/fs-metadata/issues)
[![Known Vulnerabilities](https://snyk.io/test/github/photostructure/fs-metadata/badge.svg?targetFile=package.json)](https://snyk.io/test/github/photostructure/fs-metadata?targetFile=package.json)
[![Node-API v9 Badge](https://raw.githubusercontent.com/nodejs/abi-stable-node/refs/heads/doc/assets/Node-API%20v9%20Badge.svg)](https://nodejs.org/dist/latest/docs/api/n-api.html#node-api-version-matrix)
[![View on GitHub](https://img.shields.io/badge/View%20on-GitHub-blue)](https://github.com/photostructure/fs-metadata)

## Features

- Cross-platform support:
  - Windows 10+ (x64)
  - macOS 14+
  - Debian 11/Ubuntu 20.04+ (x64, arm64) (with Gnome GIO/`GVfs` mount support where available)
  - Alpine 3.21+ (x64, arm64)

- [List all mounted volumes/drives](https://photostructure.github.io/fs-metadata/functions/getVolumeMountPoints.html)

- [Get detailed volume metadata](https://photostructure.github.io/fs-metadata/functions/getVolumeMetadata.html)

- File and directory hidden attribute support:
  - [Get](https://photostructure.github.io/fs-metadata/functions/isHidden.html) and [set](https://photostructure.github.io/fs-metadata/functions/setHidden.html) hidden attributes
  - POSIX-style support (macOS and Linux)
  - Filesystem metadata support (macOS and Windows)
  - [Recursive hidden checks](https://photostructure.github.io/fs-metadata/functions/isHiddenRecursive.html)
  - [Hidden metadata queries](https://photostructure.github.io/fs-metadata/functions/getHiddenMetadata.html)

- ESM and CJS support

- Full TypeScript type definitions

- Non-blocking async native implementations

- Timeout handling for wedged network volumes

- Compatible with all current Node.js and Electron versions via [Node-API v9](https://nodejs.org/api/n-api.html#node-api) and [prebuildify](https://github.com/prebuild/prebuildify)

- Comprehensive test coverage

## Supported Platforms

Prebuilt binaries are provided for the following platforms:

| Platform | Architecture | Node.js | Minimum OS Version |
|----------|--------------|---------|-------------------|
| Windows | x64 | 20+ | Windows 10 |
| macOS | x64 | 20+ | macOS 14 (Sonoma) |
| macOS | arm64 | 20+ | macOS 14 (Sonoma) |
| Linux (glibc) | x64 | 20+ | Debian 11 (Bullseye), Ubuntu 20.04, GLIBC 2.31+ |
| Linux (glibc) | arm64 | 20+ | Debian 11 (Bullseye), Ubuntu 20.04, GLIBC 2.31+ |
| Linux (musl) | x64 | 20+ | Alpine 3.21 |
| Linux (musl) | arm64 | 20+ | Alpine 3.21 |

Notes:
- Linux binaries require GLIBC 2.31+ (Debian 11 Bullseye or newer). **Note**: this means the `node:20` docker image is **not** supported, due to the last several major versions of `node-gyp-build` requiring both a newer python and newer C++ version.
- Electron is supported via [Node-API](https://nodejs.org/api/n-api.html) compatibility

## Installation

```bash
npm install @photostructure/fs-metadata
```

### Building from source with debug support (Windows)

For memory leak detection and enhanced debugging on Windows:

```bash
# Clone the repository
git clone https://github.com/photostructure/fs-metadata.git
cd fs-metadata

# Install dependencies
npm install

# Build with debug configuration
node-gyp rebuild --debug

# Set environment variables for memory leak detection
set _CRTDBG_MAP_ALLOC=1
set ASAN_OPTIONS=halt_on_error=0:print_stats=1:check_initialization_order=1

# Run tests with debug build
npm test
```

The debug build includes:
- CRT memory leak detection
- AddressSanitizer support (requires Visual Studio 2019+)
- Enhanced debug logging
- Memory checkpoints for tracking allocations

## Usage

```ts
import {
  getVolumeMountPoints,
  getVolumeMetadata,
} from "@photostructure/fs-metadata";

// List all mounted volumes
const mountPoints = await getVolumeMountPoints();
console.dir({ mountPoints });

// Get metadata for a specific volume
const volumeMetadata = await getVolumeMetadata(mountPoints[0]);
console.dir({ volumeMetadata });
```

If you're using CommonJS:

```js
const {
  getVolumeMountPoints,
  getVolumeMetadata,
} = require("@photostructure/fs-metadata");

// Usage is the same as the ESM example above 
// (except of course no top-level awaits!)
```

## API

[Read the API here](https://photostructure.github.io/fs-metadata/modules.html)

## Options

### Debug Logging

Set `NODE_DEBUG=fs-meta` or `NODE_DEBUG=photostructure:fs-metadata`. The native [debuglog](https://nodejs.org/api/util.html#utildebuglogsection-callback) determines if debug logging is enabled. Debug messages from both JavaScript and native code are sent to `stderr`.

### Timeouts

Operations use a [default timeout](https://photostructure.github.io/fs-metadata/variables/TimeoutMsDefault.html), which may need adjustment for slower devices like optical drives (which can take 30+ seconds to spin up).

Windows can block system calls when remote filesystems are unhealthy due to host downtime or network issues. To handle this, we use a separate thread per mountpoint to check volume health status. While this approach uses more resources than the async N-API thread, it enables reliable timeouts for operations that would otherwise hang indefinitely.

Timeout duration may apply per-operation or per-system call, depending on the implementation.

### System Volumes

Each platform handles system volumes differently:

- Windows provides explicit metadata for "system" or "reserved" devices, though `C:\` is both a system volume and typical user storage
- Linux and macOS include various system-only mountpoints: pseudo devices, snap loopback devices, virtual memory partitions, and recovery partitions

This library uses heuristics to identify system volumes. See [Options](https://photostructure.github.io/fs-metadata/interfaces/Options.html) for default values and customization.

Note: [`getAllVolumeMetadata()`](https://photostructure.github.io/fs-metadata/functions/getAllVolumeMetadata.html) returns all volumes on Windows but only non-system volumes elsewhere by default.

## License

This project is licensed under the [MIT License](https://github.com/photostructure/fs-metadata/blob/main/LICENSE.txt).

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/photostructure/fs-metadata/blob/main/CONTRIBUTING.md) for more details.

## Security

For security-related issues, please refer to our [Security Policy](https://github.com/photostructure/fs-metadata/blob/main/SECURITY.md).
