![PhotoStructure fs-metadata logo](https://raw.githubusercontent.com/photostructure/fs-metadata/main/doc/logo.svg)

Cross-platform native Node.js module for filesystem metadata, mount points, and volume information. Built for and supported by [PhotoStructure](https://photostructure.com).

[![npm version](https://img.shields.io/npm/v/@photostructure/fs-metadata.svg)](https://www.npmjs.com/package/@photostructure/fs-metadata)
[![Build](https://github.com/photostructure/fs-metadata/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/photostructure/fs-metadata/actions/workflows/build.yml)
[![Node-API v9 Badge](https://raw.githubusercontent.com/nodejs/abi-stable-node/refs/heads/doc/assets/Node-API%20v9%20Badge.svg)](https://nodejs.org/dist/latest/docs/api/n-api.html#node-api-version-matrix)
[![View on GitHub](https://img.shields.io/badge/View%20on-GitHub-blue)](https://github.com/photostructure/fs-metadata)

## Quick start

```bash
npm install @photostructure/fs-metadata
```

```typescript
import {
  getVolumeMountPoints,
  getVolumeMetadata,
} from "@photostructure/fs-metadata";

// List all mounted volumes
const mountPoints = await getVolumeMountPoints();
console.log(mountPoints);

// Get metadata for a specific volume
const metadata = await getVolumeMetadata("/");
console.log(metadata);
```

## Features

- **Volume management**: List mount points, get volume metadata, space usage
- **Hidden files**: Get/set hidden attributes, recursive checks, cross-platform support
- **Performance**: Non-blocking async operations with timeout protection
- **TypeScript**: Type definitions with ESM and CommonJS support

## Supported platforms

| Platform      | Architecture | Node.js | OS Version                |
| ------------- | ------------ | ------- | ------------------------- |
| Windows       | x64, arm64   | 20+     | Windows 10+               |
| macOS         | x64, arm64   | 20+     | macOS 14+                 |
| Linux (glibc) | x64, arm64   | 20+     | Debian 11+, Ubuntu 20.04+ |
| Linux (musl)  | x64, arm64   | 20+     | Alpine 3.21+              |

> **Note**: Linux binaries require GLIBC 2.31+. The `node:20` Docker image is not supported.

## Documentation

- [Security reporting](./SECURITY.md) - How to report security issues
- [API Reference](https://photostructure.github.io/fs-metadata/modules.html)
- [Examples](./doc/examples.md) - Common usage patterns and recipes
- [Gotchas](./doc/gotchas.md) - Platform quirks, timeouts, and troubleshooting
- [Contributing](./CONTRIBUTING.md) - Build instructions and development guide

### Options

- **Debug**: Set `NODE_DEBUG=fs-meta` for debug output
- **Timeouts**: Configure [timeout duration](https://photostructure.github.io/fs-metadata/functions/getTimeoutMsDefault.html) for slow devices
  - Set `FS_METADATA_TIMEOUT_MS` environment variable to override the default (5000ms)
- **System Volumes**: Control [system volume filtering](https://photostructure.github.io/fs-metadata/interfaces/Options.html)

## Development

Development of this library was assisted by AI coding tools. All changes are human-reviewed and tested.
