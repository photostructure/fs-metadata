# Windows API Reference Guide

## Overview

This document serves as a comprehensive reference for all Windows APIs used in the fs-metadata project, with links to official Microsoft documentation and best practices.

## File System APIs

### GetLogicalDriveStringsW

- **Docs**: https://docs.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getlogicaldrivestringsw
- **Purpose**: Fills a buffer with strings that specify valid drives in the system
- **Security**: Buffer overflow risk if size not checked
- **Best Practice**: Always call with NULL buffer first to get required size

```cpp
DWORD size = GetLogicalDriveStringsW(0, nullptr);
if (size > 0) {
    std::unique_ptr<WCHAR[]> buffer(new WCHAR[size]);
    if (GetLogicalDriveStringsW(size, buffer.get())) {
        // Process drives
    }
}
```

### GetDriveTypeW / GetDriveTypeA

- **Docs**: https://docs.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew
- **Purpose**: Determines whether a disk drive is removable, fixed, CD-ROM, RAM disk, or network drive
- **Return Values**:
  - `DRIVE_UNKNOWN` (0)
  - `DRIVE_NO_ROOT_DIR` (1)
  - `DRIVE_REMOVABLE` (2)
  - `DRIVE_FIXED` (3)
  - `DRIVE_REMOTE` (4)
  - `DRIVE_CDROM` (5)
  - `DRIVE_RAMDISK` (6)

### GetVolumeInformationW / GetVolumeInformationA

- **Docs**: https://docs.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumeinformationw
- **Purpose**: Retrieves information about the file system and volume
- **Parameters**:
  ```cpp
  BOOL GetVolumeInformationW(
    LPCWSTR lpRootPathName,           // Root directory
    LPWSTR  lpVolumeNameBuffer,       // Volume name buffer
    DWORD   nVolumeNameSize,          // Length of name buffer
    LPDWORD lpVolumeSerialNumber,     // Volume serial number
    LPDWORD lpMaximumComponentLength, // Max file name length
    LPDWORD lpFileSystemFlags,        // File system options
    LPWSTR  lpFileSystemNameBuffer,   // File system name buffer
    DWORD   nFileSystemNameSize       // Length of file system name buffer
  );
  ```
- **Common Errors**:
  - `ERROR_NOT_READY`: Drive not ready (CD/DVD)
  - `ERROR_PATH_NOT_FOUND`: Invalid path

### GetDiskFreeSpaceExA

- **Docs**: https://docs.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdiskfreespaceexa
- **Purpose**: Retrieves disk space information
- **Thread Safety**: Can block on network drives
- **Parameters**:
  ```cpp
  BOOL GetDiskFreeSpaceExA(
    LPCSTR          lpDirectoryName,    // Directory name
    PULARGE_INTEGER lpFreeBytesAvailableToCaller, // Bytes available
    PULARGE_INTEGER lpTotalNumberOfBytes,          // Total bytes
    PULARGE_INTEGER lpTotalNumberOfFreeBytes       // Free bytes
  );
  ```

### GetVolumeNameForVolumeMountPointW

- **Docs**: https://docs.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getvolumenameforvolumemountpointw
- **Purpose**: Retrieves a volume GUID path for a volume mount point
- **Requirements**: Input path must end with backslash
- **Buffer Size**: 50 characters is sufficient for GUID path

```cpp
WCHAR volumeGUID[50];
if (GetVolumeNameForVolumeMountPointW(L"C:\\", volumeGUID, 50)) {
    // volumeGUID contains \\?\Volume{GUID}\
}
```

### FindFirstFileExA

- **Docs**: https://docs.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-findfirstfileexa
- **Purpose**: Searches a directory for files/subdirectories
- **Flags**:
  - `FIND_FIRST_EX_LARGE_FETCH`: Optimize for large directories
  - `FIND_FIRST_EX_ON_DISK_ENTRIES_ONLY`: Skip reparse points
- **Security**: Can follow symbolic links if not careful

### GetFileAttributesW / SetFileAttributesW

- **Docs**:
  - https://docs.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileattributesw
  - https://docs.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileattributesw
- **Purpose**: Get/set file attributes including hidden flag
- **Common Attributes**:
  - `FILE_ATTRIBUTE_HIDDEN` (0x2)
  - `FILE_ATTRIBUTE_SYSTEM` (0x4)
  - `FILE_ATTRIBUTE_DIRECTORY` (0x10)
  - `FILE_ATTRIBUTE_NORMAL` (0x80)
- **Error Handling**: Returns `INVALID_FILE_ATTRIBUTES` on error

## Network APIs

### WNetGetConnectionA

- **Docs**: https://docs.microsoft.com/en-us/windows/win32/api/winnetwk/nf-winnetwk-wnetgetconnectiona
- **Purpose**: Retrieves network connection for a local device
- **Header**: `#include <winnetwk.h>`
- **Library**: `-lMpr.lib`
- **Buffer Management**:
  ```cpp
  DWORD bufferSize = MAX_PATH;
  std::unique_ptr<char[]> buffer(new char[bufferSize]);
  DWORD result = WNetGetConnectionA("Z:", buffer.get(), &bufferSize);
  if (result == ERROR_MORE_DATA) {
      buffer.reset(new char[bufferSize]);
      result = WNetGetConnectionA("Z:", buffer.get(), &bufferSize);
  }
  ```

## String Conversion APIs

### MultiByteToWideChar

- **Docs**: https://docs.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-multibytetowidechar
- **Purpose**: Maps a character string to a UTF-16 wide character string
- **Security**: Use `MB_ERR_INVALID_CHARS` to detect invalid sequences
- **Integer Overflow Protection**: Always validate returned size before allocation
- **Pattern**:
  ```cpp
  int len = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                source, -1, nullptr, 0);
  if (len <= 0) {
      // Handle error
      return L"";
  }

  // Validate size to prevent overflow
  if (len > PATHCCH_MAX_CCH) {
      throw std::runtime_error("String too long for conversion");
  }

  std::wstring result(static_cast<size_t>(len - 1), L'\0');
  int written = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                    source, -1, &result[0], len);
  if (written <= 0) {
      throw std::runtime_error("Conversion failed");
  }
  ```

### WideCharToMultiByte

- **Docs**: https://docs.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-widechartomultibyte
- **Purpose**: Maps a UTF-16 wide character string to a character string
- **Flags**: Use `WC_ERR_INVALID_CHARS` for Vista+ to detect errors
- **Integer Overflow Protection**: Validate size before `size - 1` subtraction
- **Pattern**:
  ```cpp
  int size = WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);

  if (size <= 0) {
      return "";  // Conversion failed
  }

  // Check for overflow and excessive size (1MB limit recommended)
  if (size > INT_MAX - 1 || size > 1024 * 1024) {
      throw std::runtime_error("String conversion size exceeds reasonable limits");
  }

  std::string result(static_cast<size_t>(size - 1), 0);
  int written = WideCharToMultiByte(CP_UTF8, 0, wide, -1, &result[0], size, nullptr, nullptr);
  if (written <= 0) {
      throw std::runtime_error("String conversion failed");
  }
  return result;
  ```

## Shell APIs

### SHGetFolderPathW

- **Docs**: https://docs.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shgetfolderpathw
- **Purpose**: Gets path to special folders
- **Common CSIDLs**:
  - `CSIDL_WINDOWS`: Windows directory
  - `CSIDL_SYSTEM`: System directory
  - `CSIDL_PROGRAM_FILES`: Program Files
- **Buffer Size**: MAX_PATH is always sufficient

### PathCchCanonicalizeEx

- **Docs**: https://docs.microsoft.com/en-us/windows/win32/api/pathcch/nf-pathcch-pathcchcanonicalize
- **Purpose**: Simplifies a path by removing navigation elements with extended options
- **Header**: `#include <pathcch.h>`
- **Library**: `-lPathcch.lib`
- **Security**: Prevents directory traversal attacks
- **Long Path Support**: Use `PATHCCH_ALLOW_LONG_PATHS` flag for paths > MAX_PATH (260 chars)
- **Buffer Size**: `PATHCCH_MAX_CCH` (32,768 characters) supports Windows 10+ long paths
- **Usage**:
  ```cpp
  wchar_t canonicalPath[PATHCCH_MAX_CCH];
  HRESULT hr = PathCchCanonicalizeEx(
      canonicalPath,
      PATHCCH_MAX_CCH,
      inputPath,
      PATHCCH_ALLOW_LONG_PATHS  // Enable long path support
  );
  ```
- **Note**: Supersedes `PathCchCanonicalize` which is limited to MAX_PATH (260 chars)

## Threading APIs

### CreateThread

- **Docs**: https://docs.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createthread
- **Best Practice**: Always store handle for cleanup
- **Never**: Never use `TerminateThread` - it can corrupt process state

### WaitForSingleObject / WaitForMultipleObjects

- **Docs**: https://docs.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject
- **Timeout**: Use INFINITE carefully - prefer specific timeouts
- **Return Values**:
  - `WAIT_OBJECT_0`: Success
  - `WAIT_TIMEOUT`: Timeout elapsed
  - `WAIT_FAILED`: Error occurred

### Critical Sections

- **Initialize**: `InitializeCriticalSection`
- **Enter**: `EnterCriticalSection` (blocking)
- **Try Enter**: `TryEnterCriticalSection` (non-blocking)
- **Leave**: `LeaveCriticalSection`
- **Delete**: `DeleteCriticalSection`
- **Best Practice**: Use RAII wrapper to ensure cleanup

## Memory Management

### Heap Functions

- **HeapAlloc**: Allocate memory from heap
- **HeapFree**: Free heap memory
- **HeapValidate**: Validate heap integrity
- **GetProcessHeap**: Get default process heap

### Debug CRT Functions (Debug builds only)

```cpp
#ifdef _DEBUG
#define _CRTDBG_MAP_ALLOC
#include <crtdbg.h>

// Enable leak detection
_CrtSetDbgFlag(_CRTDBG_ALLOC_MEM_DF | _CRTDBG_LEAK_CHECK_DF);

// Set allocation breakpoint
_CrtSetBreakAlloc(1234); // Break on allocation #1234

// Check memory state
_CrtCheckMemory();

// Dump leaks on exit
_CrtDumpMemoryLeaks();
#endif
```

## Security Considerations

### Path Validation

1. Check for null bytes
2. Check for directory traversal (..)
3. Check for device names (CON, PRN, AUX, etc.)
4. Check for alternate data streams
5. Validate UTF-8 sequences
6. Use `PathCchCanonicalizeEx` with `PATHCCH_ALLOW_LONG_PATHS` for normalization
7. Validate path length:
   - Legacy limit: MAX_PATH (260 characters)
   - Windows 10+ limit: PATHCCH_MAX_CCH (32,768 wide characters)
   - UTF-8 validation: Account for multi-byte sequences (up to 3 bytes per wide char)

### Buffer Overflow Prevention

1. Always check buffer sizes
2. Use safe string functions (StringCch\*)
3. Validate all input lengths
4. Use dynamic allocation when size unknown
5. **Integer overflow checks** for string conversions:
   - Validate `MultiByteToWideChar`/`WideCharToMultiByte` return values
   - Check `size > INT_MAX - 1` before subtraction
   - Enforce reasonable size limits (e.g., 1MB for general strings)
   - Use `static_cast<size_t>()` for allocations to prevent sign issues

### Handle Management

1. Always close handles
2. Use RAII wrappers
3. Check for INVALID_HANDLE_VALUE
4. Never use handles after closing

### Thread Safety

1. Protect shared data with synchronization
2. Use atomic operations where appropriate
3. Avoid blocking operations in critical sections
4. Always clean up threads gracefully

## Error Handling

### Common Error Codes

- `ERROR_SUCCESS` (0): Operation successful
- `ERROR_FILE_NOT_FOUND` (2): File not found
- `ERROR_PATH_NOT_FOUND` (3): Path not found
- `ERROR_ACCESS_DENIED` (5): Access denied
- `ERROR_INVALID_HANDLE` (6): Invalid handle
- `ERROR_NOT_READY` (21): Device not ready
- `ERROR_SHARING_VIOLATION` (32): File in use
- `ERROR_NETWORK_ACCESS_DENIED` (65): Network access denied
- `ERROR_BAD_NETPATH` (53): Network path not found
- `ERROR_MORE_DATA` (234): More data available
- `ERROR_NO_MORE_FILES` (18): No more files

### FormatMessage

```cpp
LPVOID msgBuffer;
FormatMessageA(
    FORMAT_MESSAGE_ALLOCATE_BUFFER |
    FORMAT_MESSAGE_FROM_SYSTEM |
    FORMAT_MESSAGE_IGNORE_INSERTS,
    NULL,
    GetLastError(),
    MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
    (LPSTR)&msgBuffer,
    0,
    NULL
);
// Use message
LocalFree(msgBuffer);
```

## Testing Recommendations

### Memory Leak Detection

```bash
# Build debug version
node-gyp rebuild --debug

# Set CRT debug flags
set _CRTDBG_MAP_ALLOC=1

# Run with leak detection
node --expose-gc test.js
```

### Address Sanitizer

```bash
# Set ASan options
set ASAN_OPTIONS=halt_on_error=0:print_stats=1:check_initialization_order=1

# Run tests
npm test
```

### Performance Profiling

1. Use Visual Studio Performance Profiler
2. Enable heap profiling
3. Monitor handle counts in Task Manager
4. Use Performance Monitor for system metrics
