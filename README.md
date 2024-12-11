# @photostructure/fs-metadata

A cross-platform native Node.js module for retrieving filesystem metadata including mount points, volume information, and space utilization statistics.

Built and supported by [PhotoStructure](https://photostructure.com).

[![npm version](https://img.shields.io/npm/v/@photostructure/fs-metadata.svg)](https://www.npmjs.com/package/@photostructure/fs-metadata)
[![Test](https://github.com/photostructure/fs-metadata/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/photostructure/fs-metadata/actions/workflows/test.yml)
[![GitHub issues](https://img.shields.io/github/issues/photostructure/fs-metadata.svg)](https://github.com/photostructure/fs-metadata/issues)
[![Known Vulnerabilities](https://snyk.io/test/github/photostructure/fs-metadata/badge.svg?targetFile=package.json)](https://snyk.io/test/github/photostructure/fs-metadata?targetFile=package.json)
[![Node-API v9 Badge](https://github.com/nodejs/abi-stable-node/blob/doc/assets/Node-API%20v9%20Badge.svg)](https://nodejs.org/dist/latest/docs/api/n-api.html#node-api-version-matrix)
[![View on GitHub](https://img.shields.io/badge/View%20on-GitHub-blue)](https://github.com/photostructure/fs-metadata)

## Features

- List all mounted volumes/drives on the system
- Get detailed volume metadata including:
  - Total size, used space, and available space
  - Filesystem type and volume label
  - Volume UUID (when available)
  - Remote/network share information
- Cross-platform support:
  - Windows (x64, arm64)
  - macOS (x64, arm64)
  - Linux (x64, arm64) (including Gnome GIO/`GVfs` mounts, if available)
- Written in modern TypeScript with full type definitions
- Native async implementations avoid blocking the event loop
- Support for both ESM and CJS consumers
- Comprehensive test coverage

## Installation

```bash
npm install @photostructure/fs-metadata
```

## Usage

```ts
import {
  getVolumeMountPoints,
  getVolumeMetadata,
} from "@photostructure/fs-metadata";

// List all mounted volumes
const mountPoints = await getVolumeMountPoints();
console.dir({ mountPoints });
// Example output: ['C:\\', 'D:\\'] on Windows
// Example output: ['/', '/home', '/Users'] on Unix-like systems

// Get metadata for a specific volume
const metadata = await getVolumeMetadata("C:\\"); // Windows
// Or for Unix-like systems:
// const metadata = await getVolumeMetadata('/');
```

If you're using CommonJS:

```js
const {
  getVolumeMountPoints,
  getVolumeMetadata,
} = require("@photostructure/fs-metadata");

// Usage is the same as the ESM example above
```

## API

[Read the API here](https://photostructure.github.io/fs-metadata/modules.html)

## Options

### Debug logging

Set the environment variable `NODE_DEBUG=fs-meta` or `NODE_DEBUG=photostructure:fs-metadata`. We query the native [debuglog](https://nodejs.org/api/util.html#utildebuglogsection-callback) to see if debug logging is enabled. Debug messages from both the javascript and native sides will be emitted to `stderr`.

### Timeouts

There is a [default
timeout](https://photostructure.github.io/fs-metadata/variables/TimeoutMsDefault.html)
applied to all operations. This may not be sufficient for some OSes and
volumes--especially powered-down optical drives (which may take 10s of seconds
to wake up).

Windows is notorious for blocking system calls if remote filesystems are in an
unhealthy state due to the host machine being down or any network glitches. To
combat this, we spin a thread per mountpoint request to determine the current
health status of a given volume. Although this is certainly more expensive than
making the call in the async N-API thread, this gives us the ability to reliably
timeout operations that would normally hang for an arbitrary amount of time
(between 20 seconds and a minute, in local testing).

Note that the timeout duration may be applied per-operation or per-syscall, depending on the cross-platform implementation.

### System volumes

Windows, Linux and macOS entertain volume mountpoints that are really only for
system use.

Windows has explicit, available metadata to denote a volume as a "system" or
"reserved" device -- but `C:\`, as it typically hosts `C:\Windows`, is both a
"system" volume as well as typically where user storage resides.

On Linux and macOS, there are a litany of mountpoints that are for system-use
only: pseudo devices, snap loopback devices, virtual memory partitions, recovery
partitions, etcetera.

This library contains a set of heuristics to try to mark these partitions as a
"system" volume, so you can skip over those devices easier. Refer to the
[Options](https://photostructure.github.io/fs-metadata/interfaces/Options.html)
documentation for default values and how to customize these patterns.

Note that
[`getAllVolumeMetadata()`](https://photostructure.github.io/fs-metadata/functions/getAllVolumeMetadata.html)
defaults to returning all volumes on Windows, and only non-system volumes
everywhere else.

## Platform-Specific Behaviors

This module's results are inherently platform-specific. Here are some things to
keep in mind:

### Mount Points

#### Windows

- Mount points are drive letters with trailing backslash (e.g., `C:\`, `D:\`)
- Network shares appear as mounted drives with UNC paths
- Volume GUIDs are available through Windows API
- Hidden and system volumes may be included

#### macOS

- Uses forward slashes for paths (e.g., `/`, `/Users`)
- Volume UUIDs may be available through the DiskArbitration framework
- Time Machine volumes should be detected and handled appropriately

#### Linux

- Uses forward slashes for paths (e.g., `/`, `/home`)
- Network mounts (NFS/CIFS) handled through mount table
- If `GIO` support is installed, it will be queried for additional mountpoints and volume metadata
- Depending on your distribution, you may want to use `{ linuxMountTablePath: "/etc/mtab" }` instead of the default, `/proc/mounts`.
- UUID detection is via `libblkid`, which must be installed.

### Volume Metadata

#### Windows

- Volume status from `GetDriveType`
- Size information from `GetDiskFreeSpaceEx`
- Volume information (label, filesystem) from `GetVolumeInformation`
- `fstype` will be `NTFS` for remote filesystems, as that's how Windows presents
  the local volume. Fixing this to be more accurate requires additional
  heuristics that have diminshing returns.
- The
  [UUID](https://photostructure.github.io/fs-metadata/interfaces/VolumeMetadata.html#uuid)
  is attempted to be extracted from the partition UUID, but if this is a remote
  volume, or system permissions do not provide access to this, we will fall back
  to returning the volume serial number that the operating system assigns. You
  can tell that it's a serial number UUID in that it only contains 8 characters
  (32 bits of entropy).

#### macOS

- Size calculations via `statvfs`
- Volume details through DiskArbitration framework
- Network share detection via volume characteristics

#### Linux

- Size information from `statvfs`
- Filesystem type from mount table and from `gio`
- Block device metadata via `libblkid`
- Network filesystem detection from mount options
- Optional GIO integration for additional metadata
- Backfills with `lsblk` metadata if native code fails

## Building from Source

Requirements:

- Supported Node.js version
- Python 3
- C++ build tools:
  - Windows: Visual Studio Build Tools
  - macOS: Xcode Command Line Tools
  - Linux: GCC and development headers

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major
changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests and documentation as appropriate.

## Security

If you discover a security vulnerability, please send an email to [security@photostructure.com](mailto:security@photostructure.com)
