# Gotchas and Platform-Specific Issues

This guide covers common issues, platform quirks, and important considerations when using `@photostructure/fs-metadata`.

## Timeout Issues

### Configuring the Default Timeout

The default timeout is 5000ms (5 seconds). You can override it in two ways:

**1. Environment variable** (applies globally):

```bash
# Linux/macOS
export FS_METADATA_TIMEOUT_MS=30000

# Windows
set FS_METADATA_TIMEOUT_MS=30000
```

**2. Per-call options** (takes precedence):

```typescript
const metadata = await getVolumeMetadata("/mnt/nas", {
  timeoutMs: 30000, // 30 seconds
});
```

The environment variable is useful for:

- CI/CD pipelines with slow or emulated environments
- Docker containers accessing remote volumes
- Systems with many network mounts

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

#### Long Path Support

Windows 10+ supports paths longer than 260 characters (MAX_PATH) when long path support is enabled:

```typescript
// Paths up to 32,768 characters are now supported
const longPath = "C:\\" + "verylongdirectoryname\\".repeat(20) + "file.txt";
const metadata = await getVolumeMetadata(longPath);
```

**Requirements**:

- Windows 10 version 1607 or later
- Long path support enabled in registry or manifest
- Path must not exceed PATHCCH_MAX_CCH (32,768 wide characters)

**Enabling long paths** (administrator required):

```powershell
# Set registry key
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
  -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
```

**Note**: Even without long path support enabled system-wide, the library handles paths up to 32,768 characters internally and fails gracefully on older systems.

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

#### Electron Consumers Need libblkid Headers

**Problem**: Electron apps that bundle `@photostructure/fs-metadata` fail to build on Linux with:

```
fatal error: blkid/blkid.h: No such file or directory
```

…even though `npm install` reports that prebuilds were found.

**Why it happens**: `@electron/rebuild` (invoked by `electron-forge`, `electron-builder`, and friends) **always recompiles native modules from source** against Electron's bundled Node ABI. The Node-ABI prebuilds shipped in `prebuilds/` are not Electron-compatible and are ignored. The fresh compile then needs the same system headers a from-source build needs.

**Solution**: Install `libblkid-dev` (and friends) on the build machine before running `electron-rebuild` / `electron-forge package`:

```bash
# Debian/Ubuntu
sudo apt-get install -y libblkid-dev

# Fedora/RHEL
sudo dnf install -y libblkid-devel

# Alpine
apk add blkid-dev
```

In CI, add this as a step before `npm install` / the Electron package step. The same applies to any consumer that compiles from source for an unsupported architecture or glibc version. See [CONTRIBUTING.md](../CONTRIBUTING.md#on-ubuntudebian) for the full development dependency list.

#### System Volume Filtering

Many mount points on Linux are system-only:

```typescript
// This filters out /proc, /sys, /dev, snap mounts, etc.
const userVolumes = await getAllVolumeMetadata({ includeSystemVolumes: false });

// To see everything:
const allVolumes = await getAllVolumeMetadata({ includeSystemVolumes: true });
```

#### btrfs Subvolumes Share a Filesystem UUID

On btrfs, several mount points can be distinct subvolumes of **one** filesystem
(e.g. `/` = `@` and `/home` = `@home`). `libblkid` keys `uuid` on the block
device, so all siblings report the **same `uuid`** and `mountFrom`:

```typescript
const root = await getVolumeMetadata("/"); // uuid: 9486d442-…
const home = await getVolumeMetadata("/home"); // uuid: 9486d442-… (same!)
```

To distinguish siblings, use the additive btrfs-only fields (all `undefined`
elsewhere): `subvolid` / `subvol` (from mount options), or the strong
`subvolumeUuid` (per-subvolume UUID via ioctl, kernel ≥ 4.18). See
[Subvolume Identity](./subvolume-identity.md) for the full rationale, stability
semantics, and how zfs/bcachefs differ.

#### ZFS Datasets Have No `uuid` — Use `fsid`

`libblkid` can't resolve a ZFS dataset name (`tank/home`) to a block device, so
ZFS datasets report **`uuid: undefined`**:

```typescript
const m = await getVolumeMetadata("/tank/home");
// { uuid: undefined, mountFrom: "tank/home", fstype: "zfs", fsid: "005856b5…" }
```

For a stable per-dataset identity, use `fsid` — a 16-hex-char id from
`statfs` `f_fsid` (the dataset's persistent fsid GUID), distinct per dataset and
stable across remount, reboot, and rename. It is **not** the `zfs get guid`
value, and `stat -f %i` prints the two halves in the opposite order. Populated on
ZFS only. See [Subvolume Identity](./subvolume-identity.md#zfs-identity-via-fsid).

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

## Mount Point Resolution (Linux and Windows)

`getMountPointForPath()` and `getVolumeMetadataForPath()` resolve a path to its
mount point by device ID matching: mount points on the same device as the
target path are candidates, and candidates that are path ancestors of the
target are strongly preferred (the deepest one wins).

When **no** candidate is a path ancestor — for example, the path is inside a
bind mount but only the canonical mount point appears in the mount table — the
longest same-device mount point is returned instead. This fallback is
intentional: it lets bind-mounted paths resolve to the correct volume.

**Gotcha**: if you pass a custom `mountPoints` array that contains no ancestor
of the target path, any same-device entry can be returned, even one with no
path relationship to the target. Build custom arrays with
`getVolumeMountPoints({ includeSystemVolumes: true })` rather than
hand-picking entries.

(macOS is unaffected: it resolves mount points natively via `fstatfs()` and
never scans a mount point list.)

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

### Blocking drive probes on Windows

Drive accessibility checks run on the Windows callback pool and are marked as
long-running so the pool can provide replacement capacity when a network
provider blocks. A timed-out OS request may still remain in that pool because
Windows cancellation is driver-dependent; avoid repeatedly probing the same
known-dead share.

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
