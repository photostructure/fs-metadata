# Linux API Reference Guide

Reference for Linux APIs used in fs-metadata, with links to official documentation.

## Table of Contents

1. [libblkid APIs](#libblkid-apis)
2. [POSIX File System APIs](#posix-file-system-apis)
3. [RAII Patterns](#raii-patterns)
4. [References](#references)

## libblkid APIs

### Overview

libblkid is part of util-linux for block device identification.

- **Man page**: https://man7.org/linux/man-pages/man3/libblkid.3.html
- **Source**: https://github.com/util-linux/util-linux/tree/master/libblkid

### blkid_get_cache / blkid_put_cache

- **Purpose**: Initialize/release blkid cache
- **Returns**: 0 on success, negative on error
- **Thread Safety**: Not documented; use mutex protection

```cpp
blkid_cache cache = nullptr;
if (blkid_get_cache(&cache, nullptr) != 0) {
    // Handle error - check errno
}
// ... use cache ...
blkid_put_cache(cache);
```

### blkid_get_tag_value

- **Docs**: https://github.com/util-linux/util-linux/blob/master/libblkid/src/resolve.c
- **Purpose**: Get UUID, LABEL, TYPE for a device
- **Returns**: `char*` allocated with `strdup()` - **caller must `free()`**

```cpp
char *uuid = blkid_get_tag_value(cache, "UUID", "/dev/sda1");
if (uuid) {
    metadata.uuid = uuid;
    free(uuid);  // IMPORTANT: Use free(), not delete or g_free
}

char *label = blkid_get_tag_value(cache, "LABEL", "/dev/sda1");
if (label) {
    metadata.label = label;
    free(label);
}
```

**Common Tags**: `UUID`, `LABEL`, `TYPE`, `PARTUUID`, `PARTLABEL`

## POSIX File System APIs

### fstatvfs (Preferred over statvfs)

- **Docs**: https://man7.org/linux/man-pages/man2/fstatvfs.2.html
- **Thread Safety**: MT-Safe
- **Purpose**: Get filesystem statistics via file descriptor (TOCTOU-safe)

```cpp
int fd = open(path, O_DIRECTORY | O_RDONLY | O_CLOEXEC);
if (fd < 0) { /* handle error */ }

struct statvfs vfs;
if (fstatvfs(fd, &vfs) != 0) { /* handle error */ }

// Use f_frsize (fragment size) for calculations, fallback to f_bsize
uint64_t blockSize = vfs.f_frsize ? vfs.f_frsize : vfs.f_bsize;
uint64_t totalSize = blockSize * vfs.f_blocks;
uint64_t available = blockSize * vfs.f_bavail;  // Available to non-root
uint64_t freeSpace = blockSize * vfs.f_bfree;   // Total free

close(fd);
```

**Key Fields**:

- `f_frsize` - Fragment size (preferred for calculations)
- `f_bsize` - Block size (fallback)
- `f_blocks` - Total blocks
- `f_bfree` - Free blocks (total)
- `f_bavail` - Free blocks (available to unprivileged users)

### open() Flags

- **Docs**: https://man7.org/linux/man-pages/man2/open.2.html

| Flag          | Purpose                           |
| ------------- | --------------------------------- |
| `O_RDONLY`    | Read-only access                  |
| `O_DIRECTORY` | Fail if not a directory           |
| `O_CLOEXEC`   | Close on exec (prevents fd leaks) |
| `O_NOFOLLOW`  | Fail if symlink (ELOOP)           |

**Always use `O_CLOEXEC`** in Node.js native modules to prevent fd leaks to child processes.

### errno Thread Safety

- **Docs**: https://man7.org/linux/man-pages/man3/errno.3.html
- On Linux, `errno` is thread-local (per POSIX requirement)
- Safe to check immediately after a failing call

```cpp
int fd = open(path, O_RDONLY | O_CLOEXEC);
if (fd < 0) {
    int err = errno;  // Capture immediately
    // err is now safe to use
}
```

## RAII Patterns

### BlkidCache RAII

```cpp
class BlkidCache {
    static std::mutex mutex_;
    blkid_cache cache_;
public:
    BlkidCache();   // Acquires cache with mutex protection
    ~BlkidCache();  // Releases cache
    blkid_cache get();

    // Move semantics supported
    BlkidCache(BlkidCache&&) noexcept;
    BlkidCache& operator=(BlkidCache&&) noexcept;

    // No copying
    BlkidCache(const BlkidCache&) = delete;
    BlkidCache& operator=(const BlkidCache&) = delete;
};
```

### File Descriptor Guard

```cpp
struct FdGuard {
    int fd;
    ~FdGuard() { if (fd >= 0) close(fd); }
};

// Usage
int fd = open(path, O_DIRECTORY | O_RDONLY | O_CLOEXEC);
if (fd < 0) { /* error */ }
FdGuard guard{fd};
// fd automatically closed when guard goes out of scope
```

## References

### libblkid / util-linux

- [libblkid(3) man page](https://man7.org/linux/man-pages/man3/libblkid.3.html)
- [util-linux GitHub](https://github.com/util-linux/util-linux)
- [blkid resolve.c](https://github.com/util-linux/util-linux/blob/master/libblkid/src/resolve.c) - Shows `strdup()` for tag values

### Linux Man Pages

- [open(2)](https://man7.org/linux/man-pages/man2/open.2.html)
- [fstatvfs(2)](https://man7.org/linux/man-pages/man2/fstatvfs.2.html)
- [errno(3)](https://man7.org/linux/man-pages/man3/errno.3.html)
