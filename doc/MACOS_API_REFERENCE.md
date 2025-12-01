# macOS API Reference Guide

This document provides comprehensive documentation for all macOS APIs used in the fs-metadata project, including usage examples, best practices, and links to official Apple documentation.

## Table of Contents

1. [Core Foundation APIs](#core-foundation-apis)
   - [CFString](#cfstring)
   - [CFDictionary](#cfdictionary)
   - [CFReleaser RAII Wrapper](#cfreleaser-raii-wrapper)
2. [DiskArbitration Framework](#diskarbitration-framework)
   - [DASession](#dasession)
   - [DASessionSetDispatchQueue](#dasessionsetdispatchqueue)
   - [DADisk](#dadisk)
3. [File System APIs](#file-system-apis)
   - [getmntinfo_r_np](#getmntinfo_r_np)
   - [statfs64](#statfs64)
   - [chflags and fchflags](#chflags-and-fchflags)
   - [open() Flags (Darwin-Specific)](#open-flags-darwin-specific)
   - [fstat, fstatfs, fstatvfs](#fstat-fstatfs-fstatvfs-toctou-safe-variants)
4. [Security APIs](#security-apis)
   - [faccessat](#faccessat)
   - [realpath()](#realpath---path-canonicalization)
5. [RAII Patterns and Memory Management](#raii-patterns-and-memory-management)
   - [Memory Management Rules](#memory-management-rules)
6. [Thread Safety Considerations](#thread-safety-considerations)
7. [Error Handling Patterns](#error-handling-patterns)
8. [Platform-Specific Considerations](#platform-specific-considerations)
9. [References](#references)

## Core Foundation APIs

### CFString

**Purpose**: String handling for Core Foundation framework interactions.

**Usage in Project**:

```cpp
// From src/darwin/volume_metadata.cpp
std::string CFStringToString(CFStringRef cfString) {
  if (!cfString) return "";

  CFIndex length = CFStringGetLength(cfString);
  CFIndex maxSize = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;

  std::string result(maxSize, '\0');
  if (CFStringGetCString(cfString, &result[0], maxSize, kCFStringEncodingUTF8)) {
    result.resize(strlen(result.c_str()));
    return result;
  }
  return "";
}
```

**Apple Documentation**: [CFString Reference](https://developer.apple.com/documentation/corefoundation/cfstring)

**Best Practices**:

- Always check for null before using
- Use `kCFStringEncodingUTF8` for UTF-8 compatibility
- Pre-allocate buffer using `CFStringGetMaximumSizeForEncoding`

### CFDictionary

**Purpose**: Key-value storage for disk properties.

**Usage in Project**:

```cpp
// Getting disk description
CFReleaser<CFDictionaryRef> diskInfo(DADiskCopyDescription(disk.get()));
if (diskInfo.get()) {
  // Extract volume name
  CFStringRef volumeName = static_cast<CFStringRef>(
    CFDictionaryGetValue(diskInfo.get(), kDADiskDescriptionVolumeNameKey)
  );
}
```

**Apple Documentation**: [CFDictionary Reference](https://developer.apple.com/documentation/corefoundation/cfdictionary)

**Common Keys Used**:

- `kDADiskDescriptionVolumeNameKey` - Volume display name
- `kDADiskDescriptionVolumeMountableKey` - Whether volume can be mounted
- `kDADiskDescriptionMediaWholeKey` - Whether this is a whole disk
- `kDADiskDescriptionVolumeUUIDKey` - Volume UUID

### CFReleaser RAII Wrapper

**Purpose**: Automatic memory management for Core Foundation objects.

**Implementation**:

```cpp
template <typename T>
class CFReleaser {
private:
  T obj_;

public:
  explicit CFReleaser(T obj = nullptr) : obj_(obj) {}
  ~CFReleaser() { if (obj_) CFRelease(obj_); }

  // Move semantics
  CFReleaser(CFReleaser&& other) noexcept : obj_(other.obj_) {
    other.obj_ = nullptr;
  }

  CFReleaser& operator=(CFReleaser&& other) noexcept {
    if (this != &other) {
      if (obj_) CFRelease(obj_);
      obj_ = other.obj_;
      other.obj_ = nullptr;
    }
    return *this;
  }

  // Delete copy operations
  CFReleaser(const CFReleaser&) = delete;
  CFReleaser& operator=(const CFReleaser&) = delete;

  T get() const { return obj_; }
  explicit operator bool() const { return obj_ != nullptr; }
};
```

## DiskArbitration Framework

### DASession

**Purpose**: Communication channel with DiskArbitration daemon.

**Usage in Project**:

```cpp
// Thread-safe session creation
std::lock_guard<std::mutex> lock(g_diskArbitrationMutex);
CFReleaser<DASessionRef> session(DASessionCreate(kCFAllocatorDefault));
if (!session.get()) {
  throw std::runtime_error("Failed to create DiskArbitration session");
}
```

**Apple Documentation**: [DiskArbitration Framework](https://developer.apple.com/documentation/diskarbitration)

**DiskArbitration Programming Guide**: [Apple Archive](https://developer.apple.com/library/archive/documentation/DriversKernelHardware/Conceptual/DiskArbitrationProgGuide/Introduction/Introduction.html)

**Important Notes**:

- Must be protected by mutex for thread safety
- Session should be short-lived
- Requires scheduling on a dispatch queue or run loop before use

### DASessionSetDispatchQueue

**Purpose**: Schedule a DiskArbitration session on a dispatch queue for callbacks.

**Apple's Documented Pattern**:

1. Create session with `DASessionCreate()`
2. Schedule on dispatch queue with `DASessionSetDispatchQueue()`
3. Use the session for disk operations
4. Unschedule by calling `DASessionSetDispatchQueue(session, NULL)`
5. Release the session

**Usage in Project**:

```cpp
// Create session
DASessionRef session = DASessionCreate(kCFAllocatorDefault);
if (!session) {
  throw std::runtime_error("Failed to create DA session");
}

// Schedule on a serial queue (NOT main queue in Node.js context)
// Static queue is intentional - singleton for process lifetime
static dispatch_queue_t da_queue = dispatch_queue_create(
    "com.example.diskarbitration", DISPATCH_QUEUE_SERIAL);
DASessionSetDispatchQueue(session, da_queue);

// Use session...
DADiskRef disk = DADiskCreateFromBSDName(kCFAllocatorDefault, session, "disk1s1");
CFDictionaryRef desc = DADiskCopyDescription(disk);

// CRITICAL: Unschedule before release
DASessionSetDispatchQueue(session, NULL);
CFRelease(session);
```

**Why We Use a Static Dispatch Queue**:

The dispatch queue is intentionally static (process lifetime) because:

1. Creating/destroying queues is expensive
2. Releasing while operations in-flight could race
3. GCD queues are lightweight references to internal structures
4. This pattern is standard for long-lived resources in macOS apps

**RAII Wrapper for Safe Session Management**:

```cpp
class DASessionRAII {
  CFReleaser<DASessionRef> session_;
  bool is_scheduled_ = false;
public:
  explicit DASessionRAII(DASessionRef s) : session_(s) {}

  void scheduleOnQueue(dispatch_queue_t queue) {
    if (session_.isValid() && queue) {
      DASessionSetDispatchQueue(session_.get(), queue);
      is_scheduled_ = true;
    }
  }

  ~DASessionRAII() noexcept {
    // CRITICAL: Unschedule before CFRelease
    if (is_scheduled_ && session_.isValid()) {
      DASessionSetDispatchQueue(session_.get(), nullptr);
    }
    // CFReleaser handles the CFRelease
  }
};
```

### DADisk

**Purpose**: Represents a disk or volume for querying properties.

**Usage in Project**:

```cpp
CFReleaser<DADiskRef> disk(
  DADiskCreateFromBSDName(kCFAllocatorDefault, session.get(), bsdName.c_str())
);
if (!disk.get()) {
  throw std::runtime_error("Failed to create DADisk for " + bsdName);
}
```

**Key Functions**:

- `DADiskCreateFromBSDName` - Create from BSD name (e.g., "disk1s1")
- `DADiskCopyDescription` - Get disk properties dictionary
- `DADiskGetBSDName` - Get BSD name from DADisk

### Thread Safety

**Critical**: All DiskArbitration operations must be serialized:

```cpp
// Global mutex for all DA operations
std::mutex g_diskArbitrationMutex;

// Always lock before any DA operation
std::lock_guard<std::mutex> lock(g_diskArbitrationMutex);
```

## File System APIs

### getmntinfo_r_np

**Purpose**: Thread-safe enumeration of mounted file systems.

**Usage in Project**:

```cpp
class MountBufferRAII {
private:
  struct statfs** buffer_;
public:
  MountBufferRAII() : buffer_(nullptr) {}
  ~MountBufferRAII() { if (buffer_) free(buffer_); }
  struct statfs*** ptr() { return &buffer_; }
  struct statfs* get() { return buffer_; }
};

MountBufferRAII mntbuf;
int count = getmntinfo_r_np(mntbuf.ptr(), MNT_NOWAIT);
if (count <= 0) {
  throw FSException(CreateDetailedErrorMessage("getmntinfo_r_np", errno));
}
```

**Apple Documentation**: [getmntinfo(3)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/getmntinfo.3.html)

**Key Points**:

- `_r` suffix indicates reentrant (thread-safe)
- `_np` suffix indicates non-portable (Apple-specific)
- Allocates buffer that must be freed
- Use `MNT_NOWAIT` for non-blocking operation

### statfs64

**Purpose**: Get file system statistics for a path.

**Usage in Project**:

```cpp
struct statfs64 buf;
if (statfs64(path.c_str(), &buf) == 0) {
  volumeInfo.size = static_cast<uint64_t>(buf.f_blocks) * buf.f_bsize;
  volumeInfo.available = static_cast<uint64_t>(buf.f_bavail) * buf.f_bsize;
  volumeInfo.used = volumeInfo.size -
    (static_cast<uint64_t>(buf.f_bfree) * buf.f_bsize);
}
```

**Important Fields**:

- `f_blocks` - Total blocks in filesystem
- `f_bfree` - Free blocks
- `f_bavail` - Free blocks available to non-superuser
- `f_bsize` - Block size
- `f_fstypename` - File system type name

### chflags and fchflags

**Purpose**: Set file flags (including hidden attribute).

**IMPORTANT**: Prefer `fchflags()` over `chflags()` to prevent TOCTOU race conditions.

**Secure Usage (TOCTOU-safe)**:

```cpp
// Open file first to get a stable reference
int fd = open(path.c_str(), O_RDONLY | O_CLOEXEC);
if (fd < 0) {
  SetError(CreateDetailedErrorMessage("open", errno));
  return;
}
FdGuard fd_guard(fd);  // RAII for automatic close

// Get current flags via file descriptor
struct stat st;
if (fstat(fd, &st) != 0) {
  SetError(CreateDetailedErrorMessage("fstat", errno));
  return;
}

// Modify hidden flag
u_int32_t flags = st.st_flags;
if (hidden_) {
  flags |= UF_HIDDEN;  // Set hidden
} else {
  flags &= ~UF_HIDDEN; // Clear hidden
}

// Apply new flags via file descriptor (TOCTOU-safe)
if (fchflags(fd, flags) != 0) {
  SetError(CreateDetailedErrorMessage("fchflags", errno));
}
```

**Legacy Usage (NOT recommended - TOCTOU vulnerable)**:

```cpp
// DON'T DO THIS - vulnerable to race conditions
struct stat st;
if (stat(path_.c_str(), &st) != 0) { /* ... */ }
// WINDOW: File could be replaced here!
if (chflags(path_.c_str(), flags) != 0) { /* ... */ }
```

**Apple Documentation**: [chflags(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/chflags.2.html)

**FreeBSD Documentation** (macOS derives from BSD): [fchflags(2)](https://man.freebsd.org/cgi/man.cgi?query=fchflags&sektion=2)

**Function Signatures**:

```c
int chflags(const char *path, u_int flags);   // Path-based (TOCTOU risk)
int fchflags(int fd, u_int flags);            // FD-based (TOCTOU-safe)
int lchflags(const char *path, u_int flags);  // Operates on symlink itself
```

**Common Flags**:

- `UF_HIDDEN` - Hidden file flag (user-settable)
- `UF_IMMUTABLE` - File cannot be changed (user-settable)
- `UF_APPEND` - File may only be appended to
- `SF_ARCHIVED` - File has been archived (super-user only)
- `SF_IMMUTABLE` - File cannot be changed (super-user only)

**Error Codes for fchflags()**:

- `EBADF` - Invalid file descriptor
- `EINVAL` - fd refers to a socket, not a file
- `EPERM` - Insufficient permissions to change flags
- `EROFS` - File resides on read-only filesystem
- `ENOTSUP` - Filesystem doesn't support file flags

### open() Flags (Darwin-Specific)

**Purpose**: Control file opening behavior for security and resource management.

**Darwin XNU fcntl.h Source**: [apple/darwin-xnu fcntl.h](https://github.com/apple/darwin-xnu/blob/main/bsd/sys/fcntl.h)

**Critical Flags**:

| Flag          | Value        | Purpose                                               |
| ------------- | ------------ | ----------------------------------------------------- |
| `O_CLOEXEC`   | `0x01000000` | Close fd on exec(), prevents leaks to child processes |
| `O_NOFOLLOW`  | `0x00000100` | Fail with `ELOOP` if path is a symlink                |
| `O_SYMLINK`   | `0x00200000` | Open the symlink itself, not its target               |
| `O_DIRECTORY` | `0x00100000` | Fail if not a directory                               |

**O_CLOEXEC - Preventing File Descriptor Leaks**:

```cpp
// ALWAYS use O_CLOEXEC when opening files in a Node.js native module
// This prevents fd leaks when Node.js forks child processes
int fd = open(path.c_str(), O_RDONLY | O_CLOEXEC);
```

Without `O_CLOEXEC`, file descriptors leak to child processes created via `fork()`/`exec()`, potentially causing resource exhaustion or security issues.

**O_NOFOLLOW vs O_SYMLINK**:

```cpp
// O_NOFOLLOW: Fail if target is a symlink (returns ELOOP)
// Use this to prevent symlink attacks
int fd = open(path.c_str(), O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
if (fd < 0 && errno == ELOOP) {
  // Path is a symlink - handle appropriately
}

// O_SYMLINK: Open the symlink itself (not following it)
// Use this when you need to operate on the symlink
int fd = open(symlink_path.c_str(), O_RDONLY | O_SYMLINK | O_CLOEXEC);
```

**Reference**: [POSIX open()](https://pubs.opengroup.org/onlinepubs/9699919799/functions/open.html)

### fstat, fstatfs, fstatvfs (TOCTOU-Safe Variants)

**Purpose**: Get file/filesystem information via file descriptor to prevent TOCTOU races.

**Why File Descriptor Variants are Safer**:

The path-based functions (`stat()`, `statfs()`, `statvfs()`) are vulnerable to TOCTOU:

1. You call `stat("/path/to/file")`
2. Attacker replaces the file with a symlink to sensitive data
3. You operate on the wrong file

File descriptor variants operate on the already-opened inode, not the path.

**Usage Pattern**:

```cpp
// 1. Open with security flags
int fd = open(path.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
if (fd < 0) { /* handle error */ }
FdGuard guard(fd);

// 2. Use fd-based functions - these operate on the same inode
struct stat st;
if (fstat(fd, &st) != 0) { /* handle error */ }

struct statfs fs;
if (fstatfs(fd, &fs) != 0) { /* handle error */ }

struct statvfs vfs;
if (fstatvfs(fd, &vfs) != 0) { /* handle error */ }
```

**Function Comparison**:

| Path-based (TOCTOU risk) | FD-based (Safe)       | Purpose                 |
| ------------------------ | --------------------- | ----------------------- |
| `stat(path, &st)`        | `fstat(fd, &st)`      | File metadata           |
| `statfs(path, &fs)`      | `fstatfs(fd, &fs)`    | Filesystem info (macOS) |
| `statvfs(path, &vfs)`    | `fstatvfs(fd, &vfs)`  | Filesystem info (POSIX) |
| `chflags(path, flags)`   | `fchflags(fd, flags)` | Set file flags          |

**Reference**: [Apple Secure Coding Guide - Race Conditions](https://developer.apple.com/library/archive/documentation/Security/Conceptual/SecureCodingGuide/Articles/RaceConditions.html)

## Security APIs

### faccessat

**Purpose**: Check file accessibility with proper security.

**Usage in Project**:

```cpp
bool accessible = faccessat(AT_FDCWD, path.c_str(), R_OK, AT_EACCESS) == 0;
```

**Apple Documentation**: [faccessat(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/faccessat.2.html)

**Security Benefits**:

- `AT_FDCWD` - Use current working directory
- `AT_EACCESS` - Check using effective user/group IDs
- Prevents TOCTOU (Time-of-Check-Time-of-Use) attacks
- More secure than deprecated `access()` function

### realpath() - Path Canonicalization

**Purpose**: Resolve symbolic links, eliminate `.` and `..` components, and validate path existence.

**Apple Documentation**: [realpath(3)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/realpath.3.html)

**CERT C Secure Coding**: [FIO02-C. Canonicalize path names](https://wiki.sei.cmu.edu/confluence/x/DtcxBQ)

**Why realpath() is Essential for Security**:

1. **Symlink Resolution**: Resolves all symbolic links to their targets
2. **Path Normalization**: Eliminates `.`, `..`, and redundant slashes
3. **Existence Validation**: Returns `NULL` if path doesn't exist
4. **Prevents Directory Traversal**: `../../../etc/passwd` becomes `/etc/passwd`

**Usage in Project**:

```cpp
#include <sys/param.h>  // For PATH_MAX
#include <unistd.h>     // For realpath()

std::string ValidateAndCanonicalizePath(const std::string& path, std::string& error) {
  // Security check: Reject paths with null bytes (injection attack)
  if (path.find('\0') != std::string::npos) {
    error = "Invalid path containing null byte";
    return "";
  }

  // Canonicalize path using realpath()
  char resolved_path[PATH_MAX];
  if (realpath(path.c_str(), resolved_path) != nullptr) {
    return std::string(resolved_path);
  }

  // realpath() failed
  int err = errno;
  if (err == ENOENT) {
    error = "Path does not exist: " + path;
  } else if (err == EACCES) {
    error = "Permission denied: " + path;
  } else {
    error = "Path validation failed: " + std::string(strerror(err));
  }
  return "";
}
```

**Important Notes**:

- `realpath()` is POSIX-standard, works on macOS and Linux
- The resolved path buffer must be at least `PATH_MAX` bytes
- Returns `NULL` on error, check `errno` for details
- **Limitation**: Still has TOCTOU risk between `realpath()` and subsequent operations - combine with fd-based APIs

**Error Codes**:

- `ENOENT` - Path component does not exist
- `EACCES` - Permission denied for a path component
- `ELOOP` - Too many symbolic links (possible symlink loop)
- `ENAMETOOLONG` - Resulting path exceeds `PATH_MAX`

### Path Validation (Legacy Approach)

**Note**: Prefer `realpath()` over manual validation - it's more comprehensive.

**Simple Null Byte Check** (still useful as first-line defense):

```cpp
// Check for null bytes (path injection attack)
if (path.find('\0') != std::string::npos) {
  throw std::invalid_argument("Path cannot contain null bytes");
}
```

## RAII Patterns and Memory Management

### General RAII Template

**Purpose**: Generic RAII wrapper for C-style resources.

```cpp
template <typename T>
class ResourceRAII {
private:
  T resource_;
  std::function<void(T)> deleter_;

public:
  ResourceRAII(T resource, std::function<void(T)> deleter)
    : resource_(resource), deleter_(deleter) {}

  ~ResourceRAII() {
    if (resource_ && deleter_) {
      deleter_(resource_);
    }
  }

  // Move semantics...
  T get() const { return resource_; }
};
```

### Memory Management Rules

**Apple's Official Ownership Documentation**: [Memory Management Programming Guide for Core Foundation](https://developer.apple.com/library/archive/documentation/CoreFoundation/Conceptual/CFMemoryMgmt/Concepts/Ownership.html)

#### 1. Core Foundation Create/Copy/Get Rule

This is the fundamental rule for Core Foundation memory management:

| Function Name Contains | You Own It? | Must Call CFRelease?    |
| ---------------------- | ----------- | ----------------------- |
| **Create**             | Yes         | Yes                     |
| **Copy**               | Yes         | Yes                     |
| **Get**                | No          | No (borrowed reference) |

**Examples from DiskArbitration**:

```cpp
// DASessionCreate - you own it, must release
DASessionRef session = DASessionCreate(kCFAllocatorDefault);
// ... use session ...
CFRelease(session);  // Required

// DADiskCopyDescription - you own it, must release
CFDictionaryRef desc = DADiskCopyDescription(disk);
// ... use desc ...
CFRelease(desc);  // Required

// CFDictionaryGetValue - borrowed, do NOT release
CFStringRef name = (CFStringRef)CFDictionaryGetValue(desc, kDADiskDescriptionVolumeNameKey);
// ... use name ...
// NO CFRelease(name) - it's owned by the dictionary!
```

**Using RAII to Enforce the Rule**:

```cpp
// CFReleaser automatically releases Create/Copy results
CFReleaser<DASessionRef> session(DASessionCreate(kCFAllocatorDefault));
CFReleaser<CFDictionaryRef> desc(DADiskCopyDescription(disk.get()));

// Get results are NOT wrapped - they're borrowed
CFStringRef name = (CFStringRef)CFDictionaryGetValue(desc.get(), key);
```

#### 2. Buffer Management

- Use RAII wrappers for `malloc()`'d buffers (e.g., `getmntinfo_r_np()`)
- Prefer stack allocation when size is known at compile time
- Use `std::vector` for dynamic arrays in C++
- **Never mix `malloc()`/`free()` with `new`/`delete`**

#### 3. String Handling

- Convert `CFStringRef` to `std::string` early in the call chain
- Use `std::string` for all internal processing
- Convert back to `CFStringRef` only at API boundaries
- Use `CFStringGetCString()` with `kCFStringEncodingUTF8`

## Thread Safety Considerations

### DiskArbitration Serialization

All DiskArbitration operations must be serialized:

```cpp
// In header file
extern std::mutex g_diskArbitrationMutex;

// In implementation
std::mutex g_diskArbitrationMutex;

// Usage
{
  std::lock_guard<std::mutex> lock(g_diskArbitrationMutex);
  // All DA operations here
}
```

### Async Operations

For concurrent file system checks:

```cpp
// Limit concurrent operations
const size_t maxConcurrentChecks = 4;

// Process in batches
for (size_t i = 0; i < count; i += maxConcurrentChecks) {
  std::vector<std::future<Result>> futures;

  // Launch batch
  for (size_t j = i; j < count && j < i + maxConcurrentChecks; j++) {
    futures.push_back(std::async(std::launch::async, checkFunction));
  }

  // Collect results with timeout
  for (auto& future : futures) {
    auto status = future.wait_for(std::chrono::milliseconds(timeout));
    // Handle timeout, ready, or error states
  }
}
```

## Error Handling Patterns

### Detailed Error Messages

```cpp
std::string CreateDetailedErrorMessage(const std::string& operation, int error_code) {
  std::ostringstream oss;
  oss << operation << " failed";

  if (error_code != 0) {
    char error_buffer[256];
    if (strerror_r(error_code, error_buffer, sizeof(error_buffer)) == 0) {
      oss << ": " << error_buffer << " (errno " << error_code << ")";
    } else {
      oss << ": Unknown error (errno " << error_code << ")";
    }
  }

  return oss.str();
}
```

### Exception Hierarchy

```cpp
class FSException : public std::runtime_error {
public:
  explicit FSException(const std::string& message)
    : std::runtime_error(message) {}
};
```

### Error Recovery Strategies

1. **Network Volume Timeouts**:
   - Use timeouts for all volume operations
   - Mark as "disconnected" on timeout
   - Continue processing other volumes

2. **Permission Errors**:
   - Check with faccessat before operations
   - Provide clear error messages
   - Don't expose sensitive paths in errors

3. **APFS-Specific Issues**:
   - Handle ENOTSUP for unsupported operations
   - Provide platform-specific error messages
   - Document known limitations

## Platform-Specific Considerations

### macOS Version Compatibility

- Minimum deployment target: macOS 10.15 (Catalina)
- Use `@available` checks for newer APIs
- Provide fallbacks for older systems

### System Integrity Protection (SIP)

- Some operations may fail under SIP
- Cannot modify system files
- Hidden attribute may not work on system volumes

### File System Differences

- APFS: Modern, supports snapshots
- HFS+: Legacy, different attribute handling
- Network volumes: May have limited functionality

## References

### Apple Official Documentation

- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [Core Foundation Programming Guide](https://developer.apple.com/library/archive/documentation/CoreFoundation/Conceptual/CFDesignConcepts/CFDesignConcepts.html)
- [Core Foundation Memory Management](https://developer.apple.com/library/archive/documentation/CoreFoundation/Conceptual/CFMemoryMgmt/Concepts/Ownership.html)
- [DiskArbitration Programming Guide](https://developer.apple.com/library/archive/documentation/DriversKernelHardware/Conceptual/DiskArbitrationProgGuide/Introduction/Introduction.html)
- [DiskArbitration Framework Reference](https://developer.apple.com/documentation/diskarbitration)
- [File System Programming Guide](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/Introduction/Introduction.html)
- [Secure Coding Guide - Race Conditions](https://developer.apple.com/library/archive/documentation/Security/Conceptual/SecureCodingGuide/Articles/RaceConditions.html)

### Darwin/XNU Source Code

- [darwin-xnu fcntl.h](https://github.com/apple/darwin-xnu/blob/main/bsd/sys/fcntl.h) - Open flags (O_CLOEXEC, O_SYMLINK, etc.)

### BSD/FreeBSD Documentation (macOS derives from BSD)

- [fchflags(2)](https://man.freebsd.org/cgi/man.cgi?query=fchflags&sektion=2) - File descriptor-based flag modification
- [chflags(2)](https://man.freebsd.org/cgi/man.cgi?query=chflags&sektion=2) - BSD file flags
- [getmntinfo(3)](https://keith.github.io/xcode-man-pages/getmntinfo.3.html) - Mount information (includes `getmntinfo_r_np`)

### POSIX Standards

- [open()](https://pubs.opengroup.org/onlinepubs/9699919799/functions/open.html) - POSIX open specification
- [access()](https://man7.org/linux/man-pages/man2/faccessat.2.html) - faccessat documentation

### Security References

- [CERT C FIO02-C](https://wiki.sei.cmu.edu/confluence/x/DtcxBQ) - Canonicalize path names originating from tainted sources
