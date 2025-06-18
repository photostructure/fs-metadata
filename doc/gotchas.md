# Gotchas and Platform-Specific Issues

This guide covers common issues, platform quirks, and important considerations when using `@photostructure/fs-metadata`.

## Timeout Issues

### Network Volumes Can Hang

**Problem**: Linux, macOS, and Windows can block system calls indefinitely when network filesystems are unhealthy.

**Solution**: Always use timeouts for network volumes:

```typescript
// Default timeout may be too short for network drives
const metadata = await getVolumeMetadata("\\\\nas\\share", {
  timeoutMs: 30000, // 30 seconds
});
```

**Why it happens**:

- Windows: SMB shares can block when the remote host is down
- Linux: NFS mounts without `soft` option will retry forever
- macOS: AFP/SMB shares may hang during network interruptions

### Optical Drives

Optical drives (CD/DVD) can take 30+ seconds to spin up:

```typescript
const metadata = await getVolumeMetadata("D:\\", {
  timeoutMs: 45000, // 45 seconds for optical drives
});
```

## Platform-Specific Gotchas

### Windows

#### UNC Paths and Mapped Drives

Mapped network drives may not appear in volume listings:

```typescript
// This might not show mapped drives
const volumes = await getVolumeMountPoints();

// Use UNC path directly instead
const metadata = await getVolumeMetadata("\\\\server\\share");
```

#### System Volume Detection

`C:\` is both a system volume and user storage. The library returns it in all queries:

```typescript
const volumes = await getAllVolumeMetadata({ includeSystemVolumes: false });
// C:\ will still be included on Windows
```

#### Build Issues

If you see "No Target Architecture" errors when building from source, ensure Visual Studio build tools are properly installed. See [Windows Build Guide](./windows-build.md).

### Linux

#### Docker Containers

The `node:20` Docker image is **not supported** due to GLIBC version requirements:

```dockerfile
# ❌ Won't work
FROM node:20

# ✅ Use this instead
FROM node:20-bullseye
# or
FROM debian:bullseye
RUN apt-get update && apt-get install -y nodejs npm
```

#### System Volume Filtering

Many mount points on Linux are system-only:

```typescript
// This filters out /proc, /sys, /dev, snap mounts, etc.
const userVolumes = await getAllVolumeMetadata({ includeSystemVolumes: false });

// To see everything:
const allVolumes = await getAllVolumeMetadata({ includeSystemVolumes: true });
```

#### GVfs/FUSE Mounts

User-mounted volumes (like Google Drive, SMB shares via Nautilus) appear under `/run/user/*/gvfs`:

```typescript
const volumes = await getVolumeMountPoints();
// May include entries like:
// /run/user/1000/gvfs/smb-share:server=nas,share=documents
```

### macOS

#### APFS Containers

APFS volumes in the same container share space:

```typescript
const volumes = await getAllVolumeMetadata();
// Multiple volumes might report identical 'available' space
// because they share the same APFS container
```

#### System Integrity Protection (SIP)

Memory debugging tools like AddressSanitizer may fail due to SIP:

```bash
# This might not work on macOS with SIP enabled
ASAN_OPTIONS=detect_leaks=1 npm test
```

## Hidden Files Gotchas

### POSIX vs Native Behavior

Hidden file operations behave differently per platform:

```typescript
// On Windows: Sets hidden attribute
await setHidden("C:\\file.txt", true);
// File remains at: C:\file.txt (hidden)

// On Linux/macOS: Renames file
await setHidden("/home/user/file.txt", true);
// File moved to: /home/user/.file.txt
```

### Already Hidden Files

Setting an already-hidden file to hidden is a no-op:

```typescript
// No error, no change
await setHidden("/path/to/.hidden", true);
```

### Invalid Paths

Dot-prefixing can create invalid paths:

```typescript
// This will fail - can't hide root directory
await setHidden("/", true); // Error!

// This will fail - parent directory in path
await setHidden("/path/../file", true); // Error!
```

## Memory and Resource Management

### Handle Leaks on Windows

Each volume check uses a separate thread on Windows. With many volumes:

```typescript
// This creates one thread per volume
const volumes = await getVolumeMountPoints();

// For systems with many volumes, use smaller batches
const BATCH_SIZE = 10;
for (let i = 0; i < mountPoints.length; i += BATCH_SIZE) {
  const batch = mountPoints.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map((mp) => getVolumeMetadata(mp.mountPoint)));
}
```

### Native Memory

The native addon manages its own memory. Node's garbage collector doesn't track it:

```typescript
// Process many files in batches to avoid memory buildup
const files = getLargeFileList();
const BATCH_SIZE = 1000;

for (let i = 0; i < files.length; i += BATCH_SIZE) {
  const batch = files.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map((f) => isHidden(f)));

  // Give GC a chance to run
  await new Promise((resolve) => setImmediate(resolve));
}
```

## Testing Gotchas

### File System State

Tests can fail due to file system state changes:

```typescript
// ❌ Bad: Assumes exact values
expect(metadata.available).toBe(1000000);

// ✅ Good: Checks types and ranges
expect(typeof metadata.available).toBe("number");
expect(metadata.available).toBeGreaterThanOrEqual(0);
```

### Timing Issues

File operations may not be immediately visible:

```typescript
// After creating a file
await fs.writeFile(path, data);
// May need a small delay on some systems
await new Promise((resolve) => setTimeout(resolve, 10));
const hidden = await isHidden(path);
```

### Cross-Platform Testing

What works on one platform may fail on another:

```typescript
// Windows: This is valid
const metadata = await getVolumeMetadata("C:"); // No trailing slash

// Linux/macOS: Must have trailing slash
const metadata2 = await getVolumeMetadata("/"); // Trailing slash required
```

## Error Messages

### Common Errors and Solutions

| Error                         | Cause                  | Solution                         |
| ----------------------------- | ---------------------- | -------------------------------- |
| `ENOENT`                      | Path doesn't exist     | Check path exists before calling |
| `EACCES`                      | Permission denied      | Run with appropriate permissions |
| `ETIMEDOUT`                   | Operation timed out    | Increase `timeoutMs` option      |
| `Invalid mountPoint`          | Empty or invalid path  | Validate input before calling    |
| `statvfs failed`              | Linux filesystem issue | Check mount is accessible        |
| `GetVolumeInformation failed` | Windows API error      | Verify drive letter is correct   |

### Platform-Specific Error Patterns

```typescript
try {
  await getVolumeMetadata(mountPoint);
} catch (error) {
  if (
    process.platform === "win32" &&
    error.message.includes("cannot find the path")
  ) {
    // Windows-specific path error
  } else if (
    process.platform === "linux" &&
    error.message.includes("statvfs")
  ) {
    // Linux-specific filesystem error
  } else if (error.code === "ETIMEDOUT") {
    // Cross-platform timeout
  }
}
```

## Debug Mode

Enable debug logging to troubleshoot issues:

```bash
# Linux/macOS
NODE_DEBUG=fs-meta npm test

# Windows
set NODE_DEBUG=fs-meta && npm test
```

Debug output includes:

- Native API calls and their results
- Timeout occurrences
- Thread creation/destruction (Windows)
- Memory allocation tracking (debug builds)
