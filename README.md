# @photostructure/fs-metadata

A cross-platform native Node.js module for retrieving filesystem metadata including mount points, volume information, and space utilization statistics.

Built and supported by [PhotoStructure](https://photostructure.com).

[![npm version](https://img.shields.io/npm/v/@photostructure/fs-metadata.svg)](https://www.npmjs.com/package/@photostructure/fs-metadata)
[![Node.js CI](https://github.com/photostructure/fs-metadata/actions/workflows/test.yml/badge.svg)](https://github.com/photostructure/fs-metadata/actions/workflows/test.yml)
[![GitHub issues](https://img.shields.io/github/issues/photostructure/fs-metadata.svg)](https://github.com/photostructure/fs-metadata/issues)
[![Known Vulnerabilities](https://snyk.io/test/github/photostructure/fs-metadata/badge.svg?targetFile=package.json)](https://snyk.io/test/github/photostructure/fs-metadata?targetFile=package.json)
[![View on GitHub](https://img.shields.io/badge/View%20on-GitHub-blue)](https://github.com/photostructure/fs-metadata)

## Features

- List all mounted volumes/drives on the system
- Get detailed volume metadata including:
  - Total size, used space, and available space
  - Filesystem type and volume label
  - Volume UUID (when available)
  - Remote/network share information
  - Device identifiers
- Cross-platform support:
  - Windows (x64, arm64)
  - macOS (x64, arm64)
  - Linux (x64, arm64)
- Written in modern TypeScript with full type definitions for both ESM and CommonJS consumers
- Native async implementation to avoid blocking the event loop
- Promise-based async API
- Comprehensive test coverage

## Installation

```bash
npm install @photostructure/fs-metadata
```

## Usage

### ESM

```typescript
import { getVolumeMountPoints, getVolumeMetadata } from "@photostructure/fs-metadata";

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

### CommonJS

```javascript
const { getVolumeMountPoints, getVolumeMetadata } = require("@photostructure/fs-metadata");

// Usage is the same as ESM
```

## Documentation

API documentation is available:

- On [GitHub Pages](https://photostructure.github.io/fs-metadata)
- In the repository after running:

  ```bash
  npm run docs
  ```

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

This project uses various development tools and technologies to maintain high code quality and productivity. During development, we utilized AI-powered code analysis and generation tools, including GitHub Copilot and Claude, as development aids. These tools helped with tasks like code completion, documentation generation, and test coverage. However, all code was reviewed, tested, and validated by a human developer before inclusion in the project.

The core implementation, architecture decisions, and maintenance remain the responsibility of the human development team. If you're interested in contributing, please see our contributing guidelines above.

## Security

If you discover a security vulnerability, please send an email to [security@photostructure.com](mailto:security@photostructure.com)
