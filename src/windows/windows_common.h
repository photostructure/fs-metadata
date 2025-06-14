// src/windows/windows_common.h
// Common Windows header with proper architecture defines
// Include this first in all Windows source files

#pragma once

// Define target architecture to fix "No Target Architecture" error in winnt.h
// These should be set by the compiler, but node-gyp sometimes doesn't pass them correctly
#if defined(_M_X64) || defined(_M_AMD64)
  // x64 architecture - already defined
#elif defined(_M_ARM64)
  // ARM64 architecture - already defined
#elif defined(_M_IX86)
  // x86 architecture - already defined
#else
  // Fallback: detect from node-gyp target_arch or default to x64
  #if defined(__x86_64__) || defined(__x86_64) || defined(__amd64__) || defined(__amd64)
    #define _M_X64
  #elif defined(__aarch64__) || defined(_M_ARM64)
    #define _M_ARM64
  #elif defined(__i386__) || defined(__i386) || defined(_M_IX86)
    #define _M_IX86
  #else
    // Default to x64 if we can't detect
    #define _M_X64
  #endif
#endif

// Define _WIN64 for 64-bit architectures
#if defined(_M_X64) || defined(_M_AMD64) || defined(_M_ARM64)
  #ifndef _WIN64
    #define _WIN64
  #endif
#endif

// Include Windows headers
#include <windows.h>