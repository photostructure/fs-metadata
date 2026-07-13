# Native Build Hardening & Analysis

Baseline: [OpenSSF Compiler Options Hardening Guide for C and C++](https://best.openssf.org/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C++.html)
plus [Microsoft Learn](https://learn.microsoft.com/en-us/cpp/build/reference/c-cpp-prop-page) for MSVC.

**Read this before changing `binding.gyp`, the sanitizer scripts, or `.clang-tidy`.**
Several settings here look redundant but are load-bearing, and a few "obvious"
improvements silently break the build or silently disable a check.

## Toolchain floor

The oldest toolchain we ship binaries from is **Debian 11 Bullseye — GCC 10.2, glibc 2.31**
(`scripts/prebuild-linux-glibc.sh`). Every compiler/linker flag in `binding.gyp` was
verified against it on **both x64 and arm64**, and against Alpine/musl (GCC 14).

Consequences — do not "upgrade" these without moving the floor first:

| Flag                           | Status            | Why                                                                                                                                                                                              |
| ------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-D_FORTIFY_SOURCE=2`          | **Correct as-is** | Level 3 needs GCC 12 + glibc 2.34 (`__builtin_dynamic_object_size`). On the Bullseye floor `=3` _silently degrades to level 2_ (verified: `__USE_FORTIFY_LEVEL=2`), so `=2` is the honest value. |
| `-fstrict-flex-arrays=3`       | Deferred          | Needs GCC 13.                                                                                                                                                                                    |
| `-ftrivial-auto-var-init=zero` | Deferred          | Needs GCC 12.                                                                                                                                                                                    |

## C++ standard

**C++20 on all three platforms.** `binding.gyp` pins Linux to `-std=gnu++20`, Windows to
`/std:c++20`, and macOS to strict `c++20` via `CLANG_CXX_LANGUAGE_STANDARD`. None of the three
silently tracks the target Node version's bundled `common.gypi`.

Two deliberate choices:

- **macOS is pinned to strict `c++20`, not `gnu++20`.** Linux is the permissive one, so a GNU
  extension that creeps into the code fails on macOS first. That portability guard is the whole
  reason to pin rather than inherit.
- **The pins are explicit because the inherited standard is Node-version-locked.** `common.gypi`
  moved from C++17 to C++20 across Node majors; without explicit values the project standard
  would silently track whatever Node headers are installed.

`MACOSX_DEPLOYMENT_TARGET` stays at **10.15**. libc++ marks a handful of C++20 _library_
features unavailable on older deployment targets (`std::format`, float `std::to_chars`, parts of
`<ranges>`) — this addon uses none of them, verified by building at `-std=c++20` with
`-mmacosx-version-min=10.15`. If you reach for one of those, the deployment target is what has to
move, not the standard.

## Traps that cost real debugging time

These are all verified behaviors, not theory:

1. **`-Werror=format-security` hard-errors without `-Wformat`.**
   On its own it fails with `error: '-Wformat-security' ignored without '-Wformat'`.
   `-Wformat=2` supplies `-Wformat`, so the two must stay together.

2. **On macOS, gyp ignores `cflags`/`cflags_cc` entirely.** The make generator takes
   compile flags only from `xcode_settings` (`gyp/generator/make.py`: `if flavor == "mac"`).
   Flags placed in `cflags` under `OS=='mac'` are dead code. This bit us before: the mac
   branch carried a `cflags` list that never reached the compiler.

3. **`OTHER_CPLUSPLUSFLAGS` defaults to `["$(inherited)"]`, and that default is what pulls
   `OTHER_CFLAGS` into C++ compiles.** Setting the key _without_ `$(inherited)` silently
   drops every `OTHER_CFLAGS` hardening flag from the C++ TUs — i.e. from all of our code.
   The `$(inherited)` entry in `binding.gyp` is mandatory.

4. **gyp coerces numeric-looking strings to ints.** A condition like `fs_sanitize=="0"`
   compares `int 0` to `str "0"`, is always false, and inverts the branch — which shipped
   `_FORTIFY_SOURCE=0` in a release build during development. The sentinel is `on`/`off`.

5. **Apple `ld64` rejects `-Wl,-z,*`** (`ld: unknown options: -z`). The RELRO/NX set is
   Linux-only. Never add `-Wl,-z,nodlopen` at all — Node `dlopen()`s the addon.

6. **`-fcf-protection=full` is x86-only** (hard-errors on aarch64) and
   **`-mbranch-protection=standard` is arm64-only**. Both stay under `target_arch` conditions.

7. **`/Qspectre` and `/HIGHENTROPYVA` are NOT x64-only.** `/Qspectre` supports ARM64 since
   VS 2017 15.7; `/HIGHENTROPYVA` applies to any 64-bit image. `/CETCOMPAT` (Intel CET) is
   genuinely x64-only; ARM64 uses `/guard:signret` for PAC-based signed returns. `/Qspectre`
   does **not** require the Spectre-mitigated CRT libs to compile or link (verified: a machine
   with no `spectre` lib directory builds and links clean).

## What is enabled, and where

| Protection         | Linux                                                 | macOS                                                                                                                           | Windows                                       |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Stack canary       | `-fstack-protector-strong`                            | same                                                                                                                            | `/GS` (default) + `/sdl`                      |
| Stack-clash        | `-fstack-clash-protection`                            | _omitted_ — accepted by current Apple clang but unverified on the older clang in the macOS CI images, where it would hard-error | n/a                                           |
| FORTIFY            | `-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=2`               | same                                                                                                                            | n/a                                           |
| Std-lib assertions | `-D_GLIBCXX_ASSERTIONS`                               | `-D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_FAST` (verified effective — traps OOB)                                         | n/a                                           |
| Forward-edge CFI   | `-fcf-protection=full` (x64)                          | —                                                                                                                               | `/guard:cf` + linker `/guard:cf`              |
| Backward-edge CFI  | `-mbranch-protection=standard` (arm64)                | —                                                                                                                               | `/CETCOMPAT` (x64); `/guard:signret` (arm64)  |
| Spectre v1         | —                                                     | —                                                                                                                               | `/Qspectre` (x64 **and** arm64)               |
| ASLR / DEP         | `-fPIC` + full RELRO                                  | PIE/ASLR by default                                                                                                             | `/DYNAMICBASE`, `/HIGHENTROPYVA`, `/NXCOMPAT` |
| RELRO / NX stack   | `-Wl,-z,relro -Wl,-z,now -Wl,-z,noexecstack`          | n/a (ld64)                                                                                                                      | n/a                                           |
| Symbol visibility  | `-fvisibility=hidden` + `-fvisibility-inlines-hidden` | `GCC_SYMBOLS_PRIVATE_EXTERN` + `GCC_INLINES_ARE_PRIVATE_EXTERN`                                                                 | hidden by default                             |
| Warnings           | `-Wall -Wextra -Wformat=2 -Werror=format-security`    | same                                                                                                                            | `/W4` + `/sdl`                                |

Verified in the shipped artifacts: Linux exports the two required Node-API registration symbols
(`napi_register_module_v1`, `node_api_module_get_api_version_v1`) and no first-party
implementation symbols; ELF toolchain weak/typeinfo symbols may also remain. The binary has
`BIND_NOW` + `GNU_RELRO` and a non-executable stack. macOS exports only the same two Node-API
symbols; the Windows x64 DLL reports
_Dynamic base, NX compatible, High Entropy VA, CET compatible_, a security cookie, and a CFG
function table.

`node-addon-api` is passed with **`-isystem`** as well as `-I` so `-Wformat=2` does not report
`-Wformat-nonliteral` inside `napi-inl.h` (a third-party header we cannot fix) while keeping the
full warning set on our own code. `FSMeta::Debug::DebugLog` carries
`__attribute__((format(printf, 1, 2)))`, which both enables format checking at every
`DEBUG_LOG()` call site and suppresses `-Wformat-nonliteral` on its own `vsnprintf` forward.

## Sanitizers

`_FORTIFY_SOURCE` **must be off** under AddressSanitizer — its libc interceptors collide with
ASan's, producing false positives and negatives. Rather than depending on env-var ordering,
`binding.gyp` reads `FS_METADATA_SANITIZE`:

```bash
FS_METADATA_SANITIZE=1   # -> binding.gyp emits -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0
```

The sanitizer scripts set it for you.

| Job              | Command                              | Notes                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ASan + **UBSan** | `npm run check:memory` (Linux/macOS) | `-fsanitize=address,undefined -fno-sanitize-recover=undefined`. LSan runs where supported; macOS also gates on Apple's `leaks` tool. Without `-fno-sanitize-recover`, UBSan is _recoverable_: it prints `runtime error:` and the process still exits 0. |
| Valgrind         | part of `check:memory` (Linux)       |                                                                                                                                                                                                                                                         |

UBSan's `vptr` check is inert here: it needs RTTI, and Node's `common.gypi` builds addons with
`-fno-rtti`; clang silently omits `vptr` from the `undefined` group in that case.

### Suppression discipline (this one is a trap)

Sanitizer suppressions must name **only** specific, empirically observed third-party functions
or libraries. The LSan file covers exact Node 26/OpenSSL and Jest-context leaves plus Jest's
native resolver library; broad Node/libuv/pthread stack-frame rules also match ordinary
first-party addon allocation stacks and can hide real leaks. Suppression counts remain visible
in the job output.

## Static analysis

`.clang-tidy` **gates**: findings in the checks under `WarningsAsErrors` fail `npm run lint`.
Previously `WarningsAsErrors: ''` meant clang-tidy could never block anything.

**There is NO output filtering on any platform.** `scripts/clang-tidy.ts` used to drop
diagnostic lines matching patterns like `no member named 'x' in namespace 'std'` or
`'foo' file not found`, ostensibly to hide Homebrew-LLVM/MSVC header mismatches. Those same
patterns describe _real_ first-party bugs, and the filtering was concealing the fact that the
analysis was **fundamentally broken on both macOS and Windows**.

If toolchain noise ever reappears, **fix the toolchain configuration** — do not reintroduce
output filtering, which cannot distinguish noise from a real defect.

Four bugs worth remembering:

- **`HeaderFilterRegex` used a negative lookahead** (`^((?!/usr/include/).)*$`). clang-tidy
  matches it with `llvm::Regex`, which does **not** support lookaheads, so it matched nothing
  and **no header was ever analyzed** — excluding most of this project's logic, which lives in
  headers. A naive `.*/src/.*` is also wrong: it matches everything when the checkout lives
  under a directory named `src` (e.g. `~/src/fs-metadata`), dragging in all of
  `node_modules/node-addon-api`. The pattern enumerates our platform directories instead.
- **macOS passed the wrong sysroot flags.** The old `-nostdinc++` +
  `-isystem <brew>/opt/llvm/include/c++/v1` + `-isystem <sdk>/usr/include` combination shadows
  clang's builtin include directory, so Apple's own `<sys/_types.h>` fails with
  "unknown type name 'size_t'" and the analysis collapses into hundreds of bogus errors.
  Passing **only** `-isysroot $(xcrun --show-sdk-path)` yields zero. (Measured on
  `src/darwin/hidden.cpp`: `-isysroot` alone = 0 errors; the old flags = 20.)
- **The Windows compile database mangled every MSVC/SDK include path.** It was built as a
  shell-quoted `command` string via `join(" ")`, and those paths contain spaces
  (`C:\Program Files (x86)\...`), so clang split them into garbage arguments
  (`no such file or directory: 'Files'`). The C++ standard library was therefore never on the
  include path. It now uses the **`arguments` array form**, which is passed through verbatim.
- **The Windows compile database shadowed `<string.h>` with our own header.** It put
  `-I src/windows` on the angle-bracket search path, so MSVC's `<cstring>` — which does
  `#include <string.h>` — resolved to **`src/windows/string.h`**. The C library then appeared to
  have no `memchr`/`strlen`, cascading into bogus "use of undeclared identifier `DEBUG_LOG`"
  errors. The database now uses `-I src`, matching `binding.gyp`'s `include_dirs`. **Keep those
  two in step.**

Fixing the above surfaced a genuine defect the filtering had been hiding: `src/darwin/raii_utils.h`
used `std::move` without including `<utility>` — the header was not self-contained and only
compiled because some other header happened to pull `<utility>` in first.

If the MSVC or Windows SDK include directory cannot be located, the script now **throws** rather
than emitting a compile database with no standard library on the include path.

`src/darwin/*` is linted by the `macos-14` leg of the `lint` CI matrix. Before that it was
analyzed on no CI leg at all, because the runner excludes the non-host platform's sources.

## Deliberately not done

- **node-addon-api's `.targets` / `node_addon_api_except` dependency.** It would be tidier than
  hand-setting `NAPI_CPP_EXCEPTIONS` + `-fexceptions` + `GCC_ENABLE_CPP_EXCEPTIONS` +
  `ExceptionHandling`, but its `except.gypi` puts `MACOSX_DEPLOYMENT_TARGET: '10.7'` and
  `EnablePREfast: 'true'` into `direct_dependent_settings`, which gyp merges into the dependent
  target. That would override our pinned **10.15** macOS floor and silently switch on MSVC
  `/analyze`. Cosmetic gain, real regression risk — left alone.
- **`cppcoreguidelines-owning-memory` / `-pro-type-member-init` as clang-tidy checks.** They fire
  on legitimate patterns here: `Napi::AsyncWorker` requires a raw `new` (node-addon-api owns and
  `Destroy()`s it), and `struct statvfs`/`statfs`/btrfs ioctl args are output parameters filled
  by syscalls.
