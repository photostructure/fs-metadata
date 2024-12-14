// src/windows/system_volume.h
#pragma once
#include "../common/debug_log.h"
#include "string.h"
#include <PathCch.h>
#include <shlobj.h> // For SHGetFolderPathW and CSIDL constants
#include <string>
#include <windows.h>

// If FILE_SUPPORTS_SYSTEM_PATHS is not defined (older SDK)
#ifndef FILE_SUPPORTS_SYSTEM_PATHS
#define FILE_SUPPORTS_SYSTEM_PATHS 0x00100000
#endif

#ifndef FILE_SUPPORTS_SYSTEM_FILES
#define FILE_SUPPORTS_SYSTEM_FILES 0x00200000
#endif

namespace FSMeta {

inline bool IsSystemVolume(const std::wstring &drive) {
  WCHAR systemRoot[MAX_PATH];
  if (SUCCEEDED(
          SHGetFolderPathW(nullptr, CSIDL_WINDOWS, nullptr, 0, systemRoot))) {
    WCHAR rootPath[4];
    wcsncpy_s(rootPath, systemRoot, 3);
    rootPath[3] = '\0';

    if (_wcsnicmp(drive.c_str(), rootPath, 2) == 0) {
      DEBUG_LOG("[IsSystemVolume] %ls is a system volume", drive.c_str());
      return true;
    }
  }

  // Modern volume properties check
  DWORD volumeFlags = 0;
  wchar_t fileSystemName[MAX_PATH + 1] = {0};

  if (GetVolumeInformationW(drive.c_str(), nullptr, 0, nullptr, nullptr,
                            &volumeFlags, fileSystemName, MAX_PATH)) {

    // Check for modern system volume indicators
    if ((volumeFlags & FILE_SUPPORTS_SYSTEM_PATHS) ||
        (volumeFlags & FILE_SUPPORTS_SYSTEM_FILES)) {
      DEBUG_LOG("[IsSystemVolume] %ls has system volume flags (0x%08X)",
                drive.c_str(), volumeFlags);
      return true;
    }
  } else {
    DEBUG_LOG("[IsSystemVolume] %ls GetVolumeInformationW failed: %lu",
              drive.c_str(), GetLastError());
  }

  DEBUG_LOG("[IsSystemVolume] %ls is not a system volume", drive.c_str());
  return false;
}

// Legacy compatibility overload
inline bool IsSystemVolume(const WCHAR *drive) {
  return IsSystemVolume(std::wstring(drive));
}

} // namespace FSMeta