// src/windows/system_volume.h
#pragma once
#include "../common/debug_log.h"
#include "windows_arch.h"
#include <shlobj.h> // For SHGetFolderPathW and CSIDL constants
#include <string>

namespace FSMeta {

// Check if a drive is the Windows system volume: the drive containing the
// Windows directory (via SHGetFolderPathW/CSIDL_WINDOWS). The TypeScript
// layer adds a redundant %SystemDrive% check (see src/system_volume.ts).
//
// GetVolumeInformationW capability flags deliberately play no part here:
// 0x00100000 and 0x00200000 are FILE_SEQUENTIAL_WRITE_ONCE and
// FILE_SUPPORTS_TRANSACTIONS — not "system volume" indicators — and
// FILE_SUPPORTS_TRANSACTIONS is set on every local NTFS volume, so keying
// off them marked every NTFS data drive as a system volume.
inline bool IsSystemVolume(const std::wstring &drive) {
  WCHAR systemRoot[MAX_PATH];
  if (SUCCEEDED(
          SHGetFolderPathW(nullptr, CSIDL_WINDOWS, nullptr, 0, systemRoot))) {
    WCHAR rootPath[4];
    wcsncpy_s(rootPath, systemRoot, 3);
    rootPath[3] = L'\0';

    if (_wcsnicmp(drive.c_str(), rootPath, 2) == 0) {
      DEBUG_LOG("[IsSystemVolume] %ls is a system volume", drive.c_str());
      return true;
    }
  }

  DEBUG_LOG("[IsSystemVolume] %ls is not a system volume", drive.c_str());
  return false;
}

} // namespace FSMeta
