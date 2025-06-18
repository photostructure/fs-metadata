// src/windows/string.h

#pragma once
#include "windows_arch.h"
#include <string>

namespace FSMeta {

inline std::string WideToUtf8(const WCHAR *wide) {
  if (!wide || wide[0] == 0)
    return "";

  int size =
      WideCharToMultiByte(CP_UTF8, 0, wide, -1, nullptr, 0, nullptr, nullptr);
  if (size <= 0)
    return "";

  std::string result(size - 1, 0);
  WideCharToMultiByte(CP_UTF8, 0, wide, -1, &result[0], size, nullptr, nullptr);
  return result;
}

class PathConverter {
public:
  static std::wstring ToWString(const std::string &path) {
    if (path.empty()) {
      return L"";
    }

    int wlen = MultiByteToWideChar(CP_UTF8, 0, path.c_str(),
                                   static_cast<int>(path.length()), nullptr, 0);

    if (wlen == 0) {
      return L"";
    }

    std::wstring wpath(wlen, 0);
    if (!MultiByteToWideChar(CP_UTF8, 0, path.c_str(),
                             static_cast<int>(path.length()), &wpath[0],
                             wlen)) {
      return L"";
    }

    return wpath;
  }
};

} // namespace FSMeta