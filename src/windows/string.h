// src/windows/string.h

#pragma once
#include <string>
#include <windows.h>

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

} // namespace FSMeta