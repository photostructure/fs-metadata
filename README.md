# @photostructure/fs-metadata

A cross-platform native Node.js module for retrieving filesystem metadata including mount points, volume information, and space utilization statistics.

Built and supported by [PhotoStructure](https://photostructure.com).

[![npm version](https://img.shields.io/npm/v/@photostructure/fs-metadata.svg)](https://www.npmjs.com/package/@photostructure/fs-metadata)
[![Node.js CI](https://github.com/photostructure/fs-metadata/actions/workflows/test.yml/badge.svg)](https://github.com/photostructure/fs-metadata/actions/workflows/test.yml)
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
- Native async implementations to avoid blocking the event loop
- Promise-based async API
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

## Documentation

API documentation is available:

- On [GitHub Pages](https://photostructure.github.io/fs-metadata)
- In the repository after running:

  ```bash
  npm run docs
  ```

## Why no CommonJS support?

As of November 2024:

- All supported versions of Node.js [consider ESM to be the official standard format](https://nodejs.org/api/esm.html#introduction)

- Electron.js has [supported ESM](https://www.electronjs.org/docs/latest/tutorial/esm) for more than a year.

- TypeScript ESM support has been stable for more than a year.

- If I add CJS support, I have to figure out and run the full test matrix twice.

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
- Network shares mounted at `/Volumes/`
- APFS and HFS+ filesystems supported
- Volume UUIDs available through DiskArbitration framework
- Time Machine volumes detected and handled appropriately

#### Linux

- Uses forward slashes for paths (e.g., `/`, `/home`)
- Network mounts (NFS/CIFS) handled through mount table
- Multiple mount tables supported (`/proc/mounts`, `/etc/mtab`)
- UUID detection via libblkid
- Optional GIO support for additional mount detection

### Volume Metadata

#### Windows

- Size information from GetDiskFreeSpaceEx
- Volume information (label, filesystem) from GetVolumeInformation
- Remote status from GetDriveType
- UNC path parsing for network shares

#### macOS

- Size calculations via statvfs
- Volume details through DiskArbitration framework
- Network share detection via volume characteristics
- Time Machine volume detection

#### Linux

- Size information from statvfs
- Filesystem type from mount table
- Block device metadata via libblkid
- Network filesystem detection from mount options
- Optional GIO integration for additional metadata

### Filesystem Types

#### Windows

- NTFS
- FAT32
- exFAT
- ReFS
- Network shares (CIFS/SMB)

#### macOS

- APFS (default since macOS High Sierra)
- HFS+ (legacy)
- FAT32
- exFAT
- Network shares (AFP, SMB, NFS)

#### Linux

- ext2/3/4
- XFS
- Btrfs
- ZFS
- Network filesystems (NFS, CIFS)
- Pseudo filesystems (procfs, sysfs) - excluded by default

### Default Excluded Mount Points

#### Windows

- None by default

#### macOS

- `/dev`
- `/dev/fd`
- System volume internal mounts

#### Linux

- `/proc`
- `/sys`
- `/dev`
- `/run`
- Snap mounts
- Other virtual filesystems

### Network Share Metadata

#### Windows

- UNC paths parsed for host/share information
- SMB/CIFS protocol support
- Network status via GetDriveType

#### macOS

- AFP and SMB protocol support
- Network status via volume characteristics
- Host/share parsing from mount URLs

#### Linux

- NFS and CIFS support
- Network detection from filesystem type
- Remote info parsed from mount spec

### Performance Considerations

#### Windows

- Default timeout: 15 seconds
- Longer timeouts needed for network operations
- Drive letter enumeration is fast
- Volume metadata queries may block

#### macOS

- Default timeout: 5 seconds
- DiskArbitration queries are generally fast
- Network volume operations may be slow

#### Linux

- Default timeout: 5 seconds
- Mount table parsing is fast
- Block device operations may block
- GIO operations are asynchronous

### Error Handling

#### Windows

- Access denied errors for restricted volumes
- Network timeout errors for disconnected shares
- Invalid drive letter errors

#### macOS

- DiskArbitration framework errors
- Network disconnection handling
- Volume unmount detection

#### Linux

- Mount table parsing errors
- Block device access errors
- GIO operation failures
- Network filesystem timeouts

### Configuration Options

Common options across platforms:

- Timeout duration
- Excluded mount point patterns
- Directory-only filter

Platform-specific options:

- Linux: Mount table path selection
- Linux: GIO support enable/disable
- Windows: Network share handling
- macOS: Time Machine volume handling

### Recommendations

#### Windows

- Use default timeout (15s) for network shares
- Handle access denied errors gracefully
- Check drive type before operations

#### macOS

- Monitor volume mount/unmount notifications
- Handle Time Machine volumes appropriately
- Check network status before operations

#### Linux

- Use default mount table when possible
- Enable GIO support if available
- Handle remote filesystem timeouts

## Building from Source

Requirements:

- Supported Node.js version
- Python 3
- C++ build tools:
  - Windows: Visual Studio Build Tools
  - macOS: Xcode Command Line Tools
  - Linux: GCC and development headers

```bash
# Clone the repository
git clone https://github.com/photostructure/fs-metadata.git
cd fs-metadata

# Install dependencies
npm install

# Run tests
npm test
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests and documentation as appropriate.

## Development Tools

This project uses AI-powered tools like GitHub Copilot and Claude to assist with development, but all code is reviewed, tested, and validated by human developers. The core implementation, architecture, and maintenance remain the responsibility of the human development team.

## Security

If you discover a security vulnerability, please send an email to [security@photostructure.com](mailto:security@photostructure.com)
