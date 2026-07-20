# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

@photostructure/fs-metadata - Cross-platform native Node.js module for filesystem metadata retrieval.

### Directory Structure

- `src/` - Source code (TypeScript and C++)
- `dist/` - Compiled JavaScript output (gitignored)
- `doc/` - Static documentation (manually written, checked into git)
- `build/` - All build artifacts (gitignored)
  - `build/docs/` - Generated API documentation from TypeDoc (deployed to GitHub Pages)
- `scripts/` - Build and utility scripts
- `prebuilds/` - Prebuilt native binaries for different platforms

### Script Preferences

**Always** use TypeScript (`.ts`) scripts executed with `tsx` instead of:

- `.js` scripts (require compilation or older Node.js syntax)
- `.mjs` scripts (ESM-only, compatibility issues)
- `.cjs` scripts (CommonJS-only, less type safety)

TypeScript with tsx provides type safety, modern syntax, and seamless execution.

## Critical Knowledge

### Testing File System Metadata

**Never** expect exact equality for dynamic values (`available`, `used`) between calls. Only verify:

- Value exists and has correct type: `typeof result.available === 'number'`
- Test static properties (`size`, `mountFrom`, `fstype`) for exact equality
- Avoid range assertions (`available > 0`) - file changes can be dramatic

### Cross-Module Compatibility

Use `_dirname()` from `./dirname` instead of `__dirname` - works in both CommonJS and ESM contexts.

### Node.js Version Compatibility

Jest 30 doesn't support Node.js 23. Use Node.js 22, 24, or 26.

## System Volume Detection

**IMPORTANT: Read `doc/system-volume-detection.md` before modifying any system volume detection logic.** It documents the full detection strategy across all platforms, including flag matrices and rationale for each approach.

Summary:

- The root `/` is a sealed, read-only APFS snapshot whose **UUID changes on every OS update** — never use it for persistent identification.
- **Primary detection** combines mount flags with APFS volume roles: `MNT_SNAPSHOT || (MNT_DONTBROWSE && hasApfsRole && role != "Data")`. See `ClassifyMacVolume()` in `src/darwin/system_volume.h`.
- The APFS role string is exposed as `volumeRole` on `MountPoint` and `VolumeMetadata`.
- **Fallback** uses `MNT_SNAPSHOT` only from `statfs` `f_flags` if DA session creation fails.
- `MNT_DONTBROWSE` is safe to use **only when combined with a non-Data APFS role**. The Data volume (`/System/Volumes/Data`) has `MNT_DONTBROWSE` but role `"Data"`, so it is correctly excluded.
- Pseudo-filesystems like `devfs` (no IOMedia, no APFS role) are caught by TypeScript fstype/path heuristics.

## Subvolume Identity (btrfs)

**Read `doc/subvolume-identity.md` before modifying subvolume logic.** It covers the collision, the additive fields, and a cross-platform survey of why other filesystems don't collide the same way (zfs/bcachefs/Stratis, macOS APFS — each volume has its own UUID, Windows ReFS/Storage Spaces), plus the distinct LVM/dm duplicate-UUID hazard.

Summary:

- On btrfs, several mount points can be distinct subvolumes of **one** filesystem, so libblkid reports the **same `uuid`** for all of them. `uuid` stays the filesystem UUID; siblings are distinguished by additive fields.
- `subvol` (path) and `subvolid` (number) come from the `subvol=`/`subvolid=` mount options (`parseSubvolInfo()` in `src/linux/mtab.ts`) — btrfs-only by construction.
- `subvolumeUuid` (on `VolumeMetadata`) is the strong per-subvolume id from `BTRFS_IOC_GET_SUBVOL_INFO` (kernel ≥ 4.18, **unprivileged**), in `src/linux/volume_metadata.cpp`.
- **The ioctl returns a positive value on success** (not `0`) — treat only a negative return as failure.
- The `<linux/btrfs.h>` include is `__has_include`-guarded; Alpine prebuilds need the `linux-headers` apk package for the feature.
- **ZFS** datasets get no `uuid` (blkid can't resolve a dataset name). `fsid`
  is a quick, normally stable `statfs` identifier, but OpenZFS may remap it to
  resolve collisions. With `includeZfsGuids: true`, the TypeScript layer also
  exposes authoritative `zfsDatasetGuid` / `zfsPoolGuid` decimal strings via
  bounded `zfs` / `zpool` commands.

## Windows-Specific Issues

### Windows CI Jest Worker Failures

**Problem**: Jest worker processes fail on Windows CI environments (both x64 and ARM64) with "Jest worker encountered 4 child process exceptions".

**Solution for Memory Tests**:

Memory tests now use a standalone TypeScript runner (`src/test-utils/memory-test-runner.ts`) that bypasses Jest entirely on all platforms. This provides more accurate memory measurements without Jest overhead and avoids worker process issues.

- Run full memory check suite (includes native tools): `npm run check:memory`
- Memory test logic is in `src/test-utils/memory-test-core.ts`

**Workaround for Other Tests**:

1. Jest is configured to use single worker mode (`maxWorkers: 1`) for all Windows CI environments
2. Tests that stress worker threads or concurrency are skipped on Windows CI using `describeSkipWindowsCI` or `describePlatformStable`:

- `worker_threads.test.ts` - Worker thread integration tests
- `thread_safety.test.ts` - Concurrent operations stress tests
- `windows-memory-check.test.ts` - Memory leak detection (Windows only)
- `windows-resource-security.test.ts` - Resource handle leak tests (Windows only)

**Note**: These tests pass locally but fail in CI. The native module loads correctly, but Jest's worker process management has fundamental incompatibilities with these specific tests on GitHub Actions Windows runners.

### Build Architecture Issue

**Problem**: "No Target Architecture" error from Windows SDK headers when building with node-gyp/prebuildify.

**Solution**: Use `scripts/prebuildify-wrapper.ts` which sets the `CL` environment variable with architecture defines:

- For x64: `CL=/D_M_X64 /D_WIN64 /D_AMD64_`
- For ARM64: `CL=/D_M_ARM64 /D_WIN64`

**Why This is Necessary**:

- Prebuildify doesn't properly pass architecture defines from binding.gyp conditions
- The Windows SDK requires these macros before including `<windows.h>`
- Projects like node-sqlite avoid this by not using Windows headers directly

**Why Other Approaches Failed**:

- **Source file defines**: Would hardcode x64 defines, breaking ARM64 builds
- **windows_compat.h wrapper**: Can't distinguish x64 from ARM64 at compile time
- **binding.gyp conditions**: Not evaluated properly by prebuildify
- **msvs_settings defines**: Not passed through to the compiler

### Memory Testing Limitations

Traditional Windows tools **do not work** with Node.js native modules:

- **Dr. Memory**: Fails with "Unable to load client library: ucrtbase.dll"
- **Debug CRT builds**: Cannot be loaded by Node.js (missing debug runtime + UNC path issues)
- **Visual Leak Detector**: Requires debug builds which don't work
- **Application Verifier**: Cannot hook into Node.js memory management

Use JavaScript-based memory testing (`src/windows-memory-check.test.ts`) instead.

### Static Analysis (clang-tidy) on Windows

**Windows clang-tidy diagnostics are authoritative and are not filtered.** The generated
compilation database includes the MSVC standard library and Windows SDK using argument arrays,
so paths containing spaces remain intact and this project's `src/windows/string.h` cannot shadow
the CRT's `<string.h>`.

- Treat diagnostics in first-party code as actionable.
- Missing MSVC or SDK include directories fail compilation-database generation instead of
  producing misleading cascades of standard-library errors.
- See `doc/windows-clang-tidy.md` and `doc/native-hardening.md` before changing the setup.

### WSL Development

Run Windows commands from WSL:

```bash
cmd.exe /c "cd C:\\Users\\matth\\src\\fs-metadata && npm test"
# Or create helper: echo 'cmd.exe /c "cd C:\\Users\\matth\\src\\fs-metadata && $@"' > ~/bin/win-run
```

## Native Build Hardening & Analysis

**IMPORTANT: Read `doc/native-hardening.md` before modifying `binding.gyp`, the sanitizer
scripts, or `.clang-tidy`.** It documents the OpenSSF-based flag matrix, the GCC 10.2 / glibc
2.31 toolchain floor that gates several flags, and a set of verified traps where the obvious
change silently breaks the build or silently disables a check.

The highest-value things to know:

- **`-Werror=format-security` hard-errors without `-Wformat`** — the two must stay paired
  (`-Wformat=2` supplies it).
- **On macOS, gyp ignores `cflags`/`cflags_cc`** — only `xcode_settings` reaches the compiler.
  And `OTHER_CPLUSPLUSFLAGS` must keep `"$(inherited)"`, or the C++ TUs lose every
  `OTHER_CFLAGS` hardening flag.
- **`_FORTIFY_SOURCE` must be OFF under ASan.** `binding.gyp` keys this off the
  `FS_METADATA_SANITIZE` env var; the sanitizer scripts set it.
- **`_FORTIFY_SOURCE=3` silently degrades to level 2** on our Bullseye/GCC 10.2 floor, so `=2`
  is intentional.
- **Sanitizer suppressions must never match first-party frames.** TSan `race:` rules match any
  frame in the stack, so `race:node::` / `race:uv_` / `race:napi_` would silence _our own_ data
  races. Keep them function-specific, and re-verify by injecting a race.

## Memory Leak & Race Detection

Run `npm run check:memory` for comprehensive platform-specific testing:

- **All platforms**: JavaScript memory tests with GC triggers
- **Windows**: Handle count monitoring via `process.report`
- **Linux**: Valgrind + AddressSanitizer/LeakSanitizer/**UndefinedBehaviorSanitizer**
- **macOS**: AddressSanitizer + UBSan; runtime-load/SIP interceptor failures fail the check

Run `npm run check:tsan` for **ThreadSanitizer** (Linux). It is a separate job because TSan
cannot share a binary with ASan, and it drives `src/test-utils/tsan-stress.ts` rather than the
Jest suite — TSan's `LD_PRELOAD` is inherited by child processes and breaks the process-spawning
debuglog tests. See `doc/native-hardening.md`.

## CI/CD Test Reliability

### Critical Anti-Patterns

**Never** use these to "fix" async issues:

```javascript
// BAD: Arbitrary timeouts
await new Promise((resolve) => setTimeout(resolve, 100));
// BAD: Forcing GC
if (global.gc) global.gc();
// BAD: setImmediate in afterAll
afterAll(async () => {
  await new Promise((resolve) => setImmediate(resolve));
});
```

### Windows Directory Cleanup

Always use retry logic:

```typescript
await fsp.rm(tempDir, {
  recursive: true,
  force: true,
  maxRetries: process.platform === "win32" ? 3 : 1,
  retryDelay: process.platform === "win32" ? 100 : 0,
});
```

### Platform Performance Multipliers

- Alpine Linux (musl): 2x slower
- ARM64 emulation: 5x slower
- Windows processes: 4x slower
- macOS VMs: 4x slower

### Multi-Process Synchronization

Use explicit signals:

```javascript
console.log("READY"); // Signal readiness
console.log("RESULT:" + outcome); // Signal result
```

## Release Process

Requires repository secrets:

- `NPM_TOKEN`: npm authentication
- `GPG_PRIVATE_KEY`: ASCII-armored GPG key
- `GPG_PASSPHRASE`: GPG passphrase

Automated via GitHub Actions workflow dispatch or manual:

```bash
npm run prepare-release
git config commit.gpgsign true
npm version patch|minor|major
npm publish
git push origin main --follow-tags
```

## General guidance

Never do inline imports like `const { mkdirSync } = await import("node:fs");` -- just use standard imports.

**NEVER** add "Generated with Claude Code" or "Co-Authored-By: Claude" lines to git commit messages. Keep commits clean and professional.
