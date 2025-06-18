// windows_arch.h - Architecture defines for Windows builds
// This file ensures architecture macros are defined before including Windows
// headers

#ifndef FS_META_WINDOWS_ARCH_H
#define FS_META_WINDOWS_ARCH_H

// Define architecture macros based on predefined compiler macros
#if defined(_M_AMD64) || defined(_M_X64) || defined(_AMD64_) ||                \
    defined(__x86_64__) || defined(__x86_64) || defined(__amd64__) ||          \
    defined(__amd64)
#ifndef _M_X64
#define _M_X64 100
#endif
#ifndef _WIN64
#define _WIN64
#endif
#ifndef _AMD64_
#define _AMD64_
#endif
#elif defined(_M_ARM64) || defined(__aarch64__) || defined(_ARM64_) ||         \
    defined(__arm64)
#ifndef _M_ARM64
#define _M_ARM64 1
#endif
#ifndef _WIN64
#define _WIN64
#endif
#elif defined(_M_IX86) || defined(__i386__) || defined(__i386) ||              \
    defined(_X86_) || defined(__X86__)
#ifndef _M_IX86
#define _M_IX86 600
#endif
#endif

// Now it's safe to include Windows headers
#include <windows.h>

#endif // FS_META_WINDOWS_ARCH_H