# macOS API Reference Guide

This document provides comprehensive documentation for all macOS APIs used in the fs-metadata project, including usage examples, best practices, and links to official Apple documentation.

## Table of Contents

1. [Core Foundation APIs](#core-foundation-apis)
2. [DiskArbitration Framework](#diskarbitration-framework)
3. [File System APIs](#file-system-apis)
4. [Security APIs](#security-apis)
5. [RAII Patterns and Memory Management](#raii-patterns-and-memory-management)
6. [Thread Safety Considerations](#thread-safety-considerations)
7. [Error Handling Patterns](#error-handling-patterns)

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

**Important Notes**:
- Must be protected by mutex for thread safety
- Session should be short-lived
- No need for run loop scheduling in synchronous operations

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

### chflags

**Purpose**: Set file flags (including hidden attribute).

**Usage in Project**:
```cpp
// Get current flags
struct stat st;
if (stat(path_.c_str(), &st) != 0) {
  SetError(CreateDetailedErrorMessage("stat", errno));
  return;
}

// Modify hidden flag
u_int32_t flags = st.st_flags;
if (hidden_) {
  flags |= UF_HIDDEN;  // Set hidden
} else {
  flags &= ~UF_HIDDEN; // Clear hidden
}

// Apply new flags
if (chflags(path_.c_str(), flags) != 0) {
  SetError(CreateDetailedErrorMessage("chflags", errno));
}
```

**Apple Documentation**: [chflags(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/chflags.2.html)

**Common Flags**:
- `UF_HIDDEN` - Hidden file flag
- `UF_IMMUTABLE` - File cannot be changed
- `SF_ARCHIVED` - File has been archived

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

### Path Validation

**Purpose**: Prevent directory traversal and null byte injection attacks.

**Implementation**:
```cpp
// Check for directory traversal
if (path.find("..") != std::string::npos) {
  throw std::invalid_argument("Path cannot contain '..'");
}

// Check for null bytes
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

1. **Core Foundation Create/Copy/Get Rule**:
   - Functions with "Create" or "Copy" return owned objects (must release)
   - Functions with "Get" return borrowed references (don't release)
   - Always use CFReleaser for owned objects

2. **Buffer Management**:
   - Use RAII wrappers for malloc'd buffers
   - Prefer stack allocation when size is known
   - Use std::vector for dynamic arrays

3. **String Handling**:
   - Convert CFString to std::string early
   - Use std::string for all internal processing
   - Convert back to CFString only when needed

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

- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [Core Foundation Programming Guide](https://developer.apple.com/library/archive/documentation/CoreFoundation/Conceptual/CFDesignConcepts/CFDesignConcepts.html)
- [DiskArbitration Programming Guide](https://developer.apple.com/library/archive/documentation/DriversKernelHardware/Conceptual/DiskArbitrationProgGuide/Introduction/Introduction.html)
- [File System Programming Guide](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/Introduction/Introduction.html)