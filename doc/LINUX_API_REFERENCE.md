# Linux API Reference Guide

Reference for Linux APIs used in fs-metadata, with links to official documentation.

## Table of Contents

1. [GIO/GLib APIs](#gioglib-apis)
2. [libblkid APIs](#libblkid-apis)
3. [POSIX File System APIs](#posix-file-system-apis)
4. [RAII Patterns](#raii-patterns)
5. [References](#references)

## GIO/GLib APIs

### Thread Safety Overview

**Critical**: GIO has different thread safety guarantees for different APIs:

| API                      | Thread Safe? | Notes                                     |
| ------------------------ | ------------ | ----------------------------------------- |
| `g_unix_mounts_get()`    | Yes          | Uses `getmntent_r()` or internal `G_LOCK` |
| `g_unix_mount_get_*()`   | Yes          | Safe on `GUnixMountEntry`                 |
| `g_volume_monitor_get()` | **No**       | Main thread only                          |

**GIO Threading Docs**: https://docs.gtk.org/gio/class.VolumeMonitor.html

> "GVolumeMonitor is not thread-default-context aware and should not be used other than from the main thread."

### g_unix_mounts_get

- **Docs**: https://docs.gtk.org/gio/func.unix_mounts_get.html
- **Purpose**: Thread-safe enumeration of mounted filesystems
- **Returns**: `GList*` of `GUnixMountEntry*` (caller owns both)
- **Cleanup**: `g_list_free_full(list, (GDestroyNotify)g_unix_mount_free)`

```cpp
GList *mounts = g_unix_mounts_get(nullptr);
for (GList *l = mounts; l != nullptr; l = l->next) {
    GUnixMountEntry *entry = static_cast<GUnixMountEntry*>(l->data);
    const char *path = g_unix_mount_get_mount_path(entry);
    const char *fstype = g_unix_mount_get_fs_type(entry);
}
g_list_free_full(mounts, reinterpret_cast<GDestroyNotify>(g_unix_mount_free));
```

**Source**: https://gitlab.gnome.org/GNOME/glib/-/blob/main/gio/gunixmounts.c

### GUnixMountEntry Functions

- **Docs**: https://docs.gtk.org/gio-unix/struct.MountEntry.html
- `g_unix_mount_get_mount_path()` - Returns `const char*` (borrowed)
- `g_unix_mount_get_fs_type()` - Returns `const char*` (borrowed)
- `g_unix_mount_get_device_path()` - Returns `const char*` (borrowed)
- `g_unix_mount_free()` - Free a single entry

**Note**: String returns are borrowed - do NOT `g_free()` them.

### g_volume_monitor_get

- **Docs**: https://docs.gtk.org/gio/type_func.VolumeMonitor.get.html
- **Purpose**: Get system volume monitor for rich metadata
- **Returns**: Owned `GVolumeMonitor*` reference
- **Cleanup**: **Must** call `g_object_unref()` when done

```cpp
// IMPORTANT: Returns owned reference despite singleton-like behavior
GVolumeMonitor *monitor = g_volume_monitor_get();
// ... use monitor ...
g_object_unref(monitor);  // Required!
```

**Thread Safety Warning**: Only call from main thread. In worker threads, use only for best-effort metadata enrichment wrapped in try-catch.

### g_volume_monitor_get_mounts

- **Docs**: https://docs.gtk.org/gio/method.VolumeMonitor.get_mounts.html
- **Returns**: `GList*` of `GMount*` (caller owns list and references)
- **Cleanup**: `g_list_free_full(mounts, g_object_unref)`

### GMount / GVolume / GFile Functions

| Function                         | Returns    | Ownership           |
| -------------------------------- | ---------- | ------------------- |
| `g_mount_get_root()`             | `GFile*`   | Caller owns, unref  |
| `g_mount_get_volume()`           | `GVolume*` | Caller owns, unref  |
| `g_mount_get_name()`             | `char*`    | Caller owns, g_free |
| `g_mount_get_default_location()` | `GFile*`   | Caller owns, unref  |
| `g_file_get_path()`              | `char*`    | Caller owns, g_free |
| `g_file_get_uri()`               | `char*`    | Caller owns, g_free |
| `g_volume_get_name()`            | `char*`    | Caller owns, g_free |

**Memory Management Docs**: https://docs.gtk.org/gobject/concepts.html#reference-counting

### GLib Memory Functions

| Function             | Purpose                               |
| -------------------- | ------------------------------------- |
| `g_object_unref()`   | Decrement GObject reference count     |
| `g_free()`           | Free GLib-allocated memory            |
| `g_list_free()`      | Free GList container only             |
| `g_list_free_full()` | Free GList and elements with callback |

**Docs**: https://docs.gtk.org/glib/func.free.html

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

### GIO Smart Pointers (gio_utils.h)

```cpp
// Custom deleters
template <typename T> struct GObjectDeleter {
    void operator()(T *ptr) const { if (ptr) g_object_unref(ptr); }
};

struct GFreeDeleter {
    void operator()(void *ptr) const { if (ptr) g_free(ptr); }
};

// Smart pointer aliases
template <typename T> using GObjectPtr = std::unique_ptr<T, GObjectDeleter<T>>;

using GFilePtr = GObjectPtr<GFile>;
using GMountPtr = GObjectPtr<GMount>;
using GVolumePtr = GObjectPtr<GVolume>;
using GVolumeMonitorPtr = GObjectPtr<GVolumeMonitor>;
using GCharPtr = std::unique_ptr<char, GFreeDeleter>;
```

**Usage**:

```cpp
GVolumeMonitorPtr monitor(g_volume_monitor_get());
GFilePtr root(g_mount_get_root(mount));
GCharPtr path(g_file_get_path(root.get()));

if (path) {
    metadata.mountPoint = path.get();  // Safe - RAII handles cleanup
}
// All resources automatically freed when scope exits
```

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

### GIO/GLib Official Documentation

- [GIO Reference](https://docs.gtk.org/gio/)
- [GLib Reference](https://docs.gtk.org/glib/)
- [GObject Memory Management](https://docs.gtk.org/gobject/concepts.html#reference-counting)
- [GVolumeMonitor](https://docs.gtk.org/gio/class.VolumeMonitor.html)
- [Unix Mounts](https://docs.gtk.org/gio-unix/struct.MountEntry.html)

### GLib Source Code

- [gunixmounts.c](https://gitlab.gnome.org/GNOME/glib/-/blob/main/gio/gunixmounts.c) - Thread-safe mount enumeration implementation

### libblkid / util-linux

- [libblkid(3) man page](https://man7.org/linux/man-pages/man3/libblkid.3.html)
- [util-linux GitHub](https://github.com/util-linux/util-linux)
- [blkid resolve.c](https://github.com/util-linux/util-linux/blob/master/libblkid/src/resolve.c) - Shows `strdup()` for tag values

### Linux Man Pages

- [open(2)](https://man7.org/linux/man-pages/man2/open.2.html)
- [fstatvfs(2)](https://man7.org/linux/man-pages/man2/fstatvfs.2.html)
- [errno(3)](https://man7.org/linux/man-pages/man3/errno.3.html)
