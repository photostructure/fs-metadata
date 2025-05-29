# C++ Code Review TODO List

This document outlines a comprehensive review of all C++ files in the fs-metadata project to identify memory leaks, resource management issues, and API usage improvements.

## Common Patterns to Review

### Memory Management
- [ ] All `malloc`/`free` pairs are properly matched
- [ ] RAII patterns are used consistently for resource management
- [ ] No raw pointers that could leak on exceptions
- [ ] Smart pointers used appropriately
- [ ] All API-allocated resources are properly freed

### Platform API Usage
- [ ] Verify API availability for target OS versions
- [ ] Check for deprecated API usage
- [ ] Ensure error handling follows platform conventions
- [ ] Validate string encoding conversions

## File-by-File Review Checklist

### 1. `src/binding.cpp`
- [ ] Review NAPI memory management patterns
- [ ] Check for proper cleanup in async worker lifecycles
- [ ] Verify promise deferred resolution/rejection paths
- [ ] Validate string conversions between JS and C++
- **Platform APIs to verify**: Node-API v9 compatibility

### 2. Darwin/macOS Files

#### `src/darwin/volume_metadata.cpp`
- [ ] Verify CFRelease for all CoreFoundation objects
  - Must CFRelease DADisk objects from DADiskCreateFromBSDName
  - Must CFRelease disk descriptions from DADiskCopyDescription  
  - Must CFRelease DASession objects after use
- [ ] Check DiskArbitration API cleanup (DASessionCreate/DASessionRelease)
- [ ] Review CFStringToString conversion for memory leaks
- [ ] Validate statvfs/statfs error handling
- [ ] Check overflow protection in size calculations
- **Platform APIs to verify**: 
  - DiskArbitration framework APIs (macOS 14+) - Follows Core Foundation ownership rules
  - IOKit framework APIs
  - CoreFoundation string handling - Functions with "Create" or "Copy" require CFRelease

#### `src/darwin/volume_mount_points.cpp`
- [ ] Review getmntinfo usage and buffer management
- [ ] Verify CFURLRef lifecycle management
- [ ] Check DADiskCreateFromBSDName cleanup
- **Platform APIs to verify**:
  - `getmntinfo` behavior on macOS
  - BSD mount structure compatibility

#### `src/darwin/hidden.cpp`
- [ ] Review NSURL object lifecycle (NSURLRef)
- [ ] Check CFURLRef release patterns
- [ ] Verify resource value key handling
- **Platform APIs to verify**:
  - NSURLResourceKey APIs
  - File attribute APIs (UF_HIDDEN)

### 3. Windows Files

#### `src/windows/volume_metadata.cpp`
- [ ] Review WNetConnection RAII wrapper completeness
  - Start with 256 char buffer, handle ERROR_MORE_DATA with required size
  - Check NO_ERROR return value for success
- [ ] Check GetVolumeInformation error handling
  - Use MAX_PATH+1 for volume name and file system name buffers
  - Check nonzero return value for success, zero for failure  
- [ ] Verify wide string conversion cleanup
- [ ] Validate DeviceIoControl buffer management
- [ ] **CRITICAL: Fix thread safety of DriveHealthChecker**
  - Replace `volatile bool shouldTerminate` with `std::atomic<bool>`
  - Remove dangerous `TerminateThread` usage
  - Use proper synchronization with completion events
  - Add atomic operations for result handling
  - Increase graceful shutdown timeout to 1 second
  - Example implementation:
    ```cpp
    std::atomic<bool> shouldTerminate{false};
    std::atomic<DriveStatus> result{DriveStatus::Unknown};
    // Signal termination: shouldTerminate.store(true);
    // Check in worker: if (shouldTerminate.load()) return 0;
    ```
- **Platform APIs to verify**:
  - WNet APIs for network drives - Handle buffer too small errors
  - Volume management APIs (Windows 10+) - Fixed MAX_PATH+1 buffer sizes
  - DeviceIoControl for S.M.A.R.T. data

#### `src/windows/volume_mount_points.cpp`
- [ ] Review GetLogicalDrives usage
- [ ] Check QueryDosDevice buffer allocation
- [ ] Verify GetVolumePathNamesForVolumeName memory management
- **Platform APIs to verify**:
  - Volume enumeration APIs
  - Path name APIs

#### `src/windows/hidden.cpp`
- [ ] Review GetFileAttributes error handling
- [ ] Check SetFileAttributes validation
- [ ] Verify wide string conversions
- **Platform APIs to verify**:
  - File attribute APIs (FILE_ATTRIBUTE_HIDDEN)

### 4. Linux Files (Completed)

#### `src/linux/volume_metadata.cpp` ✅
- [x] Review BlkidCache RAII wrapper - Already excellent
- [x] Check blkid_get_tag_value free() calls - Correctly using free()
- [x] Verify GIO integration memory management - Proper smart pointers
- [x] Validate statvfs error handling - Already comprehensive
- [x] **Added**: Input validation for empty mount points
- **Platform APIs verified**:
  - libblkid API availability
  - GIO optional dependency handling
  - statvfs behavior

#### `src/linux/blkid_cache.cpp` ✅
- [x] Verify blkid_cache lifecycle - Already has proper RAII
- [x] Check error handling for cache operations - Good error handling
- [x] **Improved**: Double-check pattern in destructor for thread safety
- **Platform APIs verified**:
  - libblkid cache APIs - Proper use of blkid_get_cache/blkid_put_cache

#### `src/linux/gio_utils.cpp` (if GIO enabled) ✅
- [x] Review g_object_unref patterns - Already using GioResource RAII
- [x] Check GError cleanup - Not used in this file (GError-free patterns)
- [x] Verify GMount/GVolume reference counting - Proper ref/unref pairs
- [x] **Added**: Exception handling in forEachMount callback
- [x] **Added**: Null checks for root.get() before G_IS_FILE
- **Platform APIs verified**:
  - GLib/GIO APIs (GNOME) - Proper memory management patterns
  - GVfs mount integration

#### `src/linux/gio_mount_points.cpp` (if GIO enabled) ✅
- [x] Review g_volume_monitor lifecycle - Correct usage (singleton pattern)
- [x] Check GList cleanup patterns - Using g_list_free_full correctly
- [x] Verify string ownership - Proper GCharPtr smart pointers
- **Platform APIs verified**:
  - GVolumeMonitor APIs - Reference counting rules
  - Mount enumeration

#### `src/linux/gio_volume_metadata.cpp` (if GIO enabled) ✅
- [x] Review g_drive object management - Using GObjectPtr smart pointers
- [x] Check g_icon handling - No GIcon usage in this file
- [x] Verify string ownership - Proper GCharPtr usage
- [x] **Added**: Defensive null checks for GObjectPtr::get()
- [x] **Added**: Null checks for string getters
- **Platform APIs verified**:
  - GDrive/GVolume metadata APIs - Ownership transfer rules

## Testing Strategy

### Memory Leak Detection
1. [ ] Run valgrind, LeakSanitizer, and AddressSanitizer on Linux builds
2. [ ] Use Application Verifier on Windows
3. [ ] Enable address sanitizer for macOS builds
4. [ ] Run existing memory.test.ts with extended iterations

### API Verification
1. [ ] Use Perplexity/WebSearch to verify:
   - Minimum OS version requirements for each API
   - Deprecated API alternatives
   - Thread safety guarantees
   - Memory ownership rules
2. [ ] Cross-reference with official documentation:
   - Apple Developer Documentation
   - Microsoft Win32 API Reference
   - Linux man pages and library docs

### Resource Management
1. [ ] Add stress tests for mount/unmount cycles
2. [ ] Test with network filesystem timeouts
3. [ ] Verify cleanup on exception paths
4. [ ] Test with maximum path lengths

## Priority Items

1. **Critical**: Thread safety in Windows DriveHealthChecker
2. **High**: CoreFoundation reference counting in macOS code
3. **High**: GIO object lifecycle management
4. **Medium**: String encoding conversions across platforms
5. **Medium**: Buffer overflow protection in size calculations

## Documentation Updates Needed

- [ ] Document RAII pattern usage guidelines
- [ ] Add platform-specific memory management notes
- [ ] Create error handling best practices
- [ ] Document thread safety requirements

## Platform API Resources

### macOS/Darwin
- Core Foundation Memory Management: Functions with "Create" or "Copy" require CFRelease
- DiskArbitration: Follows standard Core Foundation ownership rules
- Key Documentation: Apple Developer Documentation for DiskArbitration framework

### Windows
- WNetGetConnection: Start with 256 chars, handle ERROR_MORE_DATA
- GetVolumeInformation: Fixed buffers of MAX_PATH+1
- Key Documentation: Microsoft Learn Win32 API Reference

### Linux
- libblkid: Use free() for blkid_get_tag_value results, blkid_put_cache() for cache
- GLib/GIO: Use g_object_unref() or g_clear_object(), match allocation functions
- Key Documentation: libblkid man pages, GNOME Developer Documentation