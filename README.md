![PhotoStructure fs-metadata logo](https://raw.githubusercontent.com/photostructure/fs-metadata/main/doc/logo.svg)

Cross-platform native Node.js module for filesystem metadata, mount points, and volume information.

[![npm version](https://img.shields.io/npm/v/@photostructure/fs-metadata.svg)](https://www.npmjs.com/package/@photostructure/fs-metadata)
[![Build](https://github.com/photostructure/fs-metadata/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/photostructure/fs-metadata/actions/workflows/build.yml)
[![Node-API v9 Badge](https://raw.githubusercontent.com/nodejs/abi-stable-node/refs/heads/doc/assets/Node-API%20v9%20Badge.svg)](https://nodejs.org/dist/latest/docs/api/n-api.html#node-api-version-matrix)
[![View on GitHub](https://img.shields.io/badge/View%20on-GitHub-blue)](https://github.com/photostructure/fs-metadata)

## Quick Start

```bash
npm install @photostructure/fs-metadata
```

```typescript
import { getVolumeMountPoints, getVolumeMetadata } from "@photostructure/fs-metadata";

// List all mounted volumes
const mountPoints = await getVolumeMountPoints();
console.log(mountPoints);

// Get metadata for a specific volume
const metadata = await getVolumeMetadata("/");
console.log(metadata);
```

## Key Features

- **Volume Management**: List mount points, get volume metadata, space usage
- **Hidden Files**: Get/set hidden attributes, recursive checks, cross-platform support
- **Performance**: Non-blocking async operations with timeout protection
- **TypeScript**: Full type definitions with ESM and CommonJS support

## Supported Platforms

| Platform | Architecture | Node.js | OS Version |
|----------|--------------|---------|------------|
| Windows | x64, arm64 | 20+ | Windows 10+ |
| macOS | x64, arm64 | 20+ | macOS 14+ |
| Linux (glibc) | x64, arm64 | 20+ | Debian 11+, Ubuntu 20.04+ |
| Linux (musl) | x64, arm64 | 20+ | Alpine 3.21+ |

> **Note**: Linux binaries require GLIBC 2.31+. The `node:20` Docker image is not supported.

## Documentation

- 📖 [API Reference](https://photostructure.github.io/fs-metadata/modules.html)
- 💡 [Examples](./doc/examples.md) - Common usage patterns and recipes
- ⚠️  [Gotchas](./doc/gotchas.md) - Platform quirks, timeouts, and troubleshooting
- 🔧 [Contributing](./CONTRIBUTING.md) - Build instructions and development guide

### Options

- **Debug**: Set `NODE_DEBUG=fs-meta` for debug output
- **Timeouts**: Configure [timeout duration](https://photostructure.github.io/fs-metadata/variables/TimeoutMsDefault.html) for slow devices
- **System Volumes**: Control [system volume filtering](https://photostructure.github.io/fs-metadata/interfaces/Options.html)

## Support

Built and supported by [PhotoStructure](https://photostructure.com)

- [GitHub Issues](https://github.com/photostructure/fs-metadata/issues)
- [Security Policy](./SECURITY.md)
- [MIT License](./LICENSE.txt)
