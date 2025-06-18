# Examples

This guide provides practical examples for using `@photostructure/fs-metadata`.

## Basic Usage

### List All Mounted Volumes

```typescript
import { getVolumeMountPoints } from "@photostructure/fs-metadata";

const mountPoints = await getVolumeMountPoints();

// Example output on Windows:
// [
//   { mountPoint: 'C:\\', status: 'healthy' },
//   { mountPoint: 'D:\\', status: 'healthy' },
//   { mountPoint: 'E:\\', status: 'unavailable' }
// ]

// Example output on Linux:
// [
//   { mountPoint: '/', status: 'healthy' },
//   { mountPoint: '/home', status: 'healthy' },
//   { mountPoint: '/mnt/nas', status: 'timeout' }
// ]
```

### Get Volume Metadata

```typescript
import { getVolumeMetadata } from "@photostructure/fs-metadata";

const metadata = await getVolumeMetadata("/");

// Example output:
// {
//   mountPoint: '/',
//   mountFrom: '/dev/sda1',
//   fstype: 'ext4',
//   size: 500107862016,
//   used: 234567890123,
//   available: 239539971893,
//   status: 'healthy'
// }
```

### Get All Volume Metadata

```typescript
import { getAllVolumeMetadata } from "@photostructure/fs-metadata";

// Get all volumes including system volumes
const allVolumes = await getAllVolumeMetadata({ includeSystemVolumes: true });

// Filter healthy volumes only
const healthyVolumes = allVolumes.filter((v) => v.status === "healthy");

// Calculate total storage
const totalStorage = healthyVolumes.reduce((sum, v) => sum + v.size, 0);
const totalUsed = healthyVolumes.reduce((sum, v) => sum + v.used, 0);
```

## Hidden Files

### Check if File is Hidden

```typescript
import { isHidden } from "@photostructure/fs-metadata";

// Simple check
const hidden = await isHidden("/path/to/file.txt");

// Check with timeout
const hidden2 = await isHidden("/mnt/slow-network/file.txt", {
  timeoutMs: 5000,
});
```

### Set Hidden Attribute

```typescript
import { setHidden } from "@photostructure/fs-metadata";

// Hide a file
await setHidden("/path/to/file.txt", true);

// Unhide a file
await setHidden("/path/to/.hidden-file", false);

// Note: On POSIX systems (Linux/macOS), this will rename the file
// to add/remove a leading dot. On Windows, it sets the hidden attribute.
```

### Recursive Hidden Check

```typescript
import { isHiddenRecursive } from "@photostructure/fs-metadata";

// Check if file or any parent directory is hidden
const hidden = await isHiddenRecursive("/home/user/.config/app/settings.json");
// Returns true because .config is hidden

// Works with Windows hidden attributes too
const hidden2 = await isHiddenRecursive("C:\\Users\\Public\\Desktop\\file.txt");
```

### Get Hidden Metadata

```typescript
import { getHiddenMetadata } from "@photostructure/fs-metadata";

const metadata = await getHiddenMetadata("/path/to/file");

// Example output:
// {
//   hidden: true,
//   hiddenByAncestor: false,
//   localSupport: 'native',  // or 'posix' or 'none'
//   exists: true
// }
```

## CommonJS Usage

```javascript
const {
  getVolumeMountPoints,
  getVolumeMetadata,
  isHidden,
  setHidden,
} = require("@photostructure/fs-metadata");

async function main() {
  const mountPoints = await getVolumeMountPoints();
  console.log("Mount points:", mountPoints);

  const metadata = await getVolumeMetadata(mountPoints[0].mountPoint);
  console.log("Volume metadata:", metadata);
}

main().catch(console.error);
```

## Error Handling

```typescript
import {
  getVolumeMetadata,
  VolumeMountPointNotAccessibleError,
  TimeoutError,
} from "@photostructure/fs-metadata";

try {
  const metadata = await getVolumeMetadata("/mnt/network-drive", {
    timeoutMs: 10000, // 10 second timeout
  });
} catch (error) {
  if (error instanceof TimeoutError) {
    console.error("Operation timed out - network drive may be unreachable");
  } else if (error instanceof VolumeMountPointNotAccessibleError) {
    console.error("Volume is not accessible:", error.message);
  } else {
    console.error("Unexpected error:", error);
  }
}
```

## Working with Network Volumes

```typescript
import {
  getVolumeMountPoints,
  getVolumeMetadata,
} from "@photostructure/fs-metadata";

// Network volumes may timeout or be unavailable
const mountPoints = await getVolumeMountPoints({ timeoutMs: 30000 });

// Filter out unhealthy volumes
const availableVolumes = mountPoints.filter((mp) => mp.status === "healthy");

// Get metadata with extended timeout for network drives
for (const mp of availableVolumes) {
  try {
    const metadata = await getVolumeMetadata(mp.mountPoint, {
      timeoutMs: 20000, // 20 seconds for network volumes
    });
    console.log(
      `${mp.mountPoint}: ${metadata.used} of ${metadata.size} bytes used`,
    );
  } catch (error) {
    console.error(
      `Failed to get metadata for ${mp.mountPoint}:`,
      error.message,
    );
  }
}
```

## Platform-Specific Examples

### Windows: List Drive Letters

```typescript
import { getVolumeMountPoints } from "@photostructure/fs-metadata";

const volumes = await getVolumeMountPoints();
const driveLetters = volumes
  .filter((v) => v.status === "healthy")
  .map((v) => v.mountPoint)
  .filter((mp) => /^[A-Z]:\\$/.test(mp))
  .sort();

console.log("Available drives:", driveLetters);
// Output: ["C:\\", "D:\\", "E:\\"]
```

### Linux: Filter System Volumes

```typescript
import { getAllVolumeMetadata } from "@photostructure/fs-metadata";

// Get only user-accessible volumes (excludes /proc, /sys, etc.)
const userVolumes = await getAllVolumeMetadata({
  includeSystemVolumes: false,
});

// Custom filtering for specific filesystem types
const dataVolumes = userVolumes.filter((v) =>
  ["ext4", "xfs", "btrfs", "zfs"].includes(v.fstype),
);
```

### macOS: APFS Volumes

```typescript
import { getAllVolumeMetadata } from "@photostructure/fs-metadata";

const volumes = await getAllVolumeMetadata();

// Find APFS volumes
const apfsVolumes = volumes.filter((v) => v.fstype === "apfs");

// APFS containers share space, so available space might be the same
const containers = new Map();
for (const vol of apfsVolumes) {
  const key = `${vol.size}-${vol.available}`;
  if (!containers.has(key)) {
    containers.set(key, []);
  }
  containers.get(key).push(vol.mountPoint);
}
```

## Debug Logging

```typescript
// Enable debug logging before importing
process.env.NODE_DEBUG = "fs-meta";

import { getVolumeMetadata } from "@photostructure/fs-metadata";

// Now operations will log debug information to stderr
const metadata = await getVolumeMetadata("/");
// Debug output includes native code operations and timing information
```
