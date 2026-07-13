# Native Build Hardening & Analysis

Baseline: [OpenSSF Compiler Options Hardening Guide for C and C++](https://best.openssf.org/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C++.html)
plus [Microsoft Learn](https://learn.microsoft.com/en-us/cpp/build/reference/c-cpp-prop-page) for MSVC.

**Read this before changing `binding.gyp`, the sanitizer scripts, or `.clang-tidy`.**
Several settings here look redundant but are load-bearing, and a few "obvious"
improvements silently break the build or silently disable a check.

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

- **`cppcoreguidelines-owning-memory` / `-pro-type-member-init` as clang-tidy checks.** They fire
  on legitimate patterns here: `Napi::AsyncWorker` requires a raw `new` (node-addon-api owns and
  `Destroy()`s it), and `struct statvfs`/`statfs`/btrfs ioctl args are output parameters filled
  by syscalls.
