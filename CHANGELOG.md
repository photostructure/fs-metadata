# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
Added for new features.
Changed for changes in existing functionality.
Deprecated for soon-to-be removed features.
Removed for now removed features.
Fixed for any bug fixes.
Security in case of vulnerabilities.
-->

## unreleased

### Added

- **Opt-in authoritative ZFS GUIDs.** `includeZfsGuids: true` adds
  `zfsDatasetGuid` and `zfsPoolGuid` as decimal strings on Linux ZFS volumes,
  using bounded, shell-free `zfs` / `zpool` queries. The default remains the
  fast syscall-only path; missing commands and query failures leave the fields
  undefined without failing metadata retrieval.

### Changed

- **Corrected the `fsid` persistence contract.** The ZFS `fsid` (from `statfs`
  `f_fsid`) is documented as normally stable but **not immutable**: OpenZFS may
  remap it to resolve a collision when duplicated datasets become active (e.g. a
  split or copied pool). It remains a useful current identity/fallback; for a
  durable identifier prefer the new opt-in `zfsDatasetGuid` / `zfsPoolGuid`. No
  code change to how `fsid` is computed — only its documented guarantee.

### Fixed

- **Linux file bind mounts now follow the API's directory-enumeration
  contract.** `getVolumeMountPoints()` and `getAllVolumeMetadata()` omit
  detected non-directory targets such as Docker's `/etc/hosts` mounts, while
  `getMountPointForPath()`, `getVolumeMetadataForPath()`, and direct
  `getVolumeMetadata()` calls still resolve and inspect those exact mounts.
  Remote targets remain unprobed when `skipNetworkVolumes` is true and are
  retained when their target type is unknown.

## [2.2.1](https://github.com/PhotoStructure/fs-metadata/releases/tag/v2.2.1) (2026-07-13)

No API changes. This release hardens the shipped native binaries and fixes the
build/analysis tooling that was silently not working.

### Security

- **Hardened native binaries on every platform**, following the [OpenSSF Compiler
  Options Hardening Guide](https://best.openssf.org/Compiler-Hardening-Guides/Compiler-Options-Hardening-Guide-for-C-and-C++.html).
  Verified in the shipped artifacts, not just on the command line:

  - **Linux:** full RELRO (`-Wl,-z,relro -Wl,-z,now`), non-executable stack,
    `-fstack-clash-protection`, `-D_GLIBCXX_ASSERTIONS`, and
    `-Wall -Wextra -Wformat=2 -Werror=format-security`.
  - **macOS:** `-fstack-protector-strong`, the same warning set, and libc++
    hardening (`_LIBCPP_HARDENING_MODE_FAST`). The previous `cflags` in the macOS
    branch were dead code — gyp ignores them there — so several of these flags had
    never actually reached the compiler.
  - **Windows:** `/Qspectre` is now also applied to **ARM64**. It is not
    x64-only (MSVC has supported it on ARM64 since VS 2017 15.7), so the ARM64
    build was under-hardened against Spectre v1.
  - **All POSIX targets:** symbol visibility is now hidden, so first-party
    implementation symbols are no longer exported. Required Node-API
    registration and platform/runtime metadata symbols remain visible.

  `_FORTIFY_SOURCE` stays at level 2: level 3 requires GCC 12 + glibc 2.34 and
  silently degrades to level 2 on this project's oldest supported build
  toolchain (Debian 11 / GCC 10.2).

### Fixed

Several of the project's own quality gates could not fail. Each is fixed, and
each fix was verified by injecting a defect and confirming it is now caught.

- **The macOS AddressSanitizer job could pass while the sanitizer was inert.** A
  SIP interceptor-startup failure — meaning ASan never hooked anything — was
  explicitly classified as an allowed outcome. It is now a hard failure, and a
  preflight check asserts the ASan runtime was actually loaded into the Node
  process before any test runs.
- **The macOS `leaks` check never gated.** Failures were printed and then ignored
  ("the leaks tool can have false positives"). It now fails the run, against a
  dedicated workload.
- **Valgrind exited 0 on errors.** `--error-exitcode` was never passed, so the
  run's pass/fail rested entirely on grepping the log. Errors now fail the job.
- **The sanitizer log analyzer was blind to UBSan and TSan.** It matched only
  `ERROR: AddressSanitizer` / `ERROR: LeakSanitizer`. ThreadSanitizer reports data
  races under a **`WARNING:`** header, and UndefinedBehaviorSanitizer's recoverable
  form is `runtime error:` — both would have been ignored even once those jobs
  existed.
- **LeakSanitizer suppressions were dangerously broad** (51 rules, including
  `leak:node::`, `leak:v8::internal::`, `leak:uv_` and libc startup). Those frames
  appear in the addon's _own_ allocation stacks, so such rules can mask real
  first-party leaks. Narrowed to 5 exact external leaf functions. The new
  ThreadSanitizer suppressions follow the same discipline, and document the
  empirical check that proves they do not hide an injected race.
- **`src/darwin/raii_utils.h` was missing `#include <utility>`** despite using
  `std::move`. The header only compiled because another header happened to pull
  `<utility>` in first.
- **Windows/macOS static analysis never actually ran.** clang-tidy was
  misconfigured on both platforms (a bad macOS sysroot; a Windows compile database
  whose MSVC include paths were mangled by shell-quoting and which shadowed the C
  library's `<string.h>` with this project's own `src/windows/string.h`). Its
  output filtering then hid the resulting failures — along with real first-party
  diagnostics. Both root causes are fixed and all output filtering is removed.
- **clang-tidy analyzed no headers at all.** `HeaderFilterRegex` used a negative
  lookahead, which `llvm::Regex` does not support, so it matched nothing —
  excluding most of this project's logic, which lives in headers.

### Changed

- **macOS now compiles as C++20**, matching Linux and Windows (which already
  inherited it from Node's headers). `MACOSX_DEPLOYMENT_TARGET` remains 10.15.
- **clang-tidy now fails the build** on high-signal lifetime/ownership checks
  (`bugprone-use-after-move`, `clang-analyzer-cplusplus.NewDeleteLeaks`,
  `cppcoreguidelines-special-member-functions`, …). It was previously advisory
  only, so findings could never block a merge.
- **`src/darwin/*` is now linted in CI.** It was analyzed on no CI leg at all.
- **UndefinedBehaviorSanitizer and ThreadSanitizer added to CI.** UBSan runs with
  `-fno-sanitize-recover` (it is recoverable by default and would otherwise report
  undefined behavior while still exiting 0). TSan runs as a separate job against a
  dedicated concurrency stress harness, since it cannot share a binary with ASan.
- **`_FORTIFY_SOURCE` is now disabled in sanitizer builds**, where its libc
  interceptors collide with the sanitizers' and produce false results.
- **arm64 coverage in CI.** The memory-test matrix now includes `ubuntu-24.04-arm`,
  and ThreadSanitizer runs on both x64 and arm64.
- **`SafeAsyncWorker` no longer shadows `Napi::AsyncWorker::SetError`.** It kept a
  parallel error store alongside node-addon-api's, which only worked because the
  completion callback was also overridden. It now delegates to node-addon-api as
  the single source of truth. No behavior change.
- **Removed dead sanitizer config.** `.asan-options` and `.asan-suppressions.txt`
  were never loaded by any script.

## [2.2.0](https://github.com/PhotoStructure/fs-metadata/releases/tag/v2.2.0) (2026-07-11)

### Changed

- **`getVolumeMetadata()` now enforces `timeoutMs` on every platform.**
  Previously Windows bypassed the JavaScript timeout and relied on the native
  probe, so a slow call resolved with `status: "timeout"`; it now **rejects**
  with a timeout error, matching Linux and macOS. `timeoutMs` bounds each
  single-volume operation (`getVolumeMetadata()`, `getVolumeMetadataForPath()`,
  `getMountPointForPath()`); `getAllVolumeMetadata()` applies it per volume, not
  as one global deadline.

- **`setHidden()` rejects unsupported hide methods.** A misspelled or otherwise
  unsupported hide method previously succeeded as a silent no-op; JavaScript
  callers now receive an error.

### Fixed

- **Timeouts now cover path resolution.** `getMountPointForPath()` and
  `getVolumeMetadataForPath()` armed their timeout only around the native call,
  so a hung `realpath()`/`stat()` on a dead mount could block past the deadline.
  The timeout now wraps the complete operation, including the initial
  `realpath()`/`stat()`. (A blocked OS request may still continue in a background
  worker — Node's filesystem promises and several platform APIs provide no
  portable cancellation.)

- **Windows drive checks stay responsive after timeouts.** Empty but accessible
  volumes are now reported healthy rather than inaccessible (a wildcard
  enumeration that finds no children returns `ERROR_FILE_NOT_FOUND`, which means
  the root is reachable). Potentially blocking probes run on the adaptive Windows
  callback pool marked with `CallbackMayRunLong()`, so timed-out network checks
  can no longer exhaust a fixed worker pool, and the addon module is pinned
  across each probe so a Worker teardown that unloads the addon cannot crash a
  still-running check.

- **Device labels and mount paths with trailing digits decode correctly.** The
  fixed-width mtab (three-digit octal) and udev symlink (two-digit hex) escape
  decoders no longer greedily consume the digits following an escape — for
  example `Backup\x202026` now decodes to `Backup 2026` instead of a stray
  U+2020 followed by `26`.

- **System-volume detection is case-exact on POSIX.** System-volume path
  patterns compare mount-point spelling exactly on Linux and macOS, while Windows
  keeps case-insensitive matching.

- **Non-existent dot-prefixed paths are no longer reported hidden.** `isHidden()`
  and `getHiddenMetadata()` reported a missing `.foo` as hidden from its name
  alone; they now confirm the path exists first (Windows still reaches native
  validation for malformed paths).

## [2.1.0](https://github.com/PhotoStructure/fs-metadata/releases/tag/v2.1.0) (2026-07-04)

### Added

- **btrfs subvolume identity (Linux).** On btrfs, several mount points can be
  distinct subvolumes of one filesystem; because libblkid keys `uuid` on the
  block device, every sibling reports the same filesystem `uuid` and cannot be
  told apart. Three additive, btrfs-only fields now distinguish them (all
  `undefined` on other filesystems; `uuid` is unchanged and still the filesystem
  UUID):

  - `MountPoint.subvol` and `MountPoint.subvolid` — the `subvol=` path and
    `subvolid=` number from the mount options, available from both
    `getVolumeMountPoints()` and `getVolumeMetadata()`.
  - `VolumeMetadata.subvolumeUuid` — the strong per-subvolume UUID from the
    unprivileged `BTRFS_IOC_GET_SUBVOL_INFO` ioctl (kernel ≥ 4.18), stable across
    remount/reboot and preserved across `btrfs send`/`receive` (as
    `received_uuid`) and snapshots (fresh uuid + `parent_uuid`). Degrades to
    `undefined` on older kernels or builds without `<linux/btrfs.h>`.

  See [`doc/subvolume-identity.md`](./doc/subvolume-identity.md) for the full
  rationale and a cross-platform survey of why other filesystems (zfs, APFS,
  ReFS, …) do not exhibit this collision.

- **ZFS dataset identity via `fsid` (Linux).** ZFS datasets report no `uuid`
  (libblkid cannot resolve a dataset name to a block device). `VolumeMetadata`
  now carries `fsid`, a normally stable but collision-adjustable per-dataset
  identifier read from `statfs(2)`'s `f_fsid` and rendered as a 16-character
  hex string, with no libzfs dependency or subprocess. Populated on ZFS only;
  `undefined` elsewhere. It is not the `zfs get guid` value; see
  [`doc/subvolume-identity.md`](./doc/subvolume-identity.md).

### Fixed

- **Native `getVolumeMetadata()` no longer aborts the process on bad input.**
  Calling the native binding directly with an empty or missing `mountPoint`
  threw a C++ exception that node-addon-api does not translate, killing Node
  with SIGABRT; it now throws a JS `TypeError` on all platforms.
- **Windows: data drives are no longer misreported as system volumes.**
  System-volume detection keyed off `GetVolumeInformationW()` flags
  `0x00100000`/`0x00200000`, which are actually `FILE_SEQUENTIAL_WRITE_ONCE`
  and `FILE_SUPPORTS_TRANSACTIONS` (the latter set on every local NTFS
  volume). Detection now uses only the Windows-directory drive comparison.
- **Windows: Unicode paths and volume labels.** `getVolumeMetadata()` and
  drive-status checks used ANSI (`...A`) Win32 APIs on UTF-8 strings, mangling
  or rejecting non-ANSI paths, labels, and UNC share names. All calls now use
  the wide (`...W`) APIs and convert at the JS boundary.
- **Windows: `timeoutMs` is honored consistently.** `getVolumeMetadata()`
  passed the default 5s to its drive-status check regardless of the option,
  and `timeoutMs: 0` (documented as "disable timeouts") was treated as an
  immediate timeout by the native Windows and macOS mount-point checks; `0`
  now disables the native timeout as documented.
- **Windows: thread-pool shutdown use-after-free.** Shutdown waited on all
  worker handles with a single `WaitForMultipleObjects()` call (which fails
  outright beyond 64 handles, e.g. on >64-logical-core machines) and then
  freed per-thread state even when workers were still running. The pool is
  now clamped to 64 threads and per-thread state is only freed once a worker
  has actually exited.
- **Module-init memory leak on Node 26 (all platforms).** The per-env shutdown
  hook allocated a heap `std::shared_ptr` whose only deleter was a
  `napi_add_env_cleanup_hook` callback. Node 26 skips those callbacks on an
  abrupt `process.exit()` (while still running napi instance-data finalizers),
  stranding the block — a one-time 16-byte "definitely lost" at module
  registration that failed the valgrind memory gate on Node 26. The separate
  allocation is gone; the instance-data finalizer now owns teardown and removes
  the hook, so nothing leaks whether or not the cleanup hook runs, and the
  shutdown-flag timing that guards teardown-time SIGABRTs is unchanged.
- **macOS: timed-out mount-point checks no longer pin the worker thread.**
  Accessibility probes used `std::async`, whose future destructor blocks
  until the task finishes — so a `faccessat()` hung on a dead network mount
  kept blocking after the timeout was reported. Probes now use a detached
  thread with a promise, whose future destructor never blocks, and in-flight
  probes are deduplicated per path so repeated polling of a hung mount reuses
  its stuck probe instead of accumulating threads. The probing phase also
  shares a single `timeoutMs` deadline, so N dead mounts no longer take
  N × `timeoutMs`.
- **Native debug logging data race.** The debug-enabled flag and prefix were
  plain globals written from the JS thread and read from worker threads; the
  flag is now atomic and the prefix mutex-guarded.
- **Linux: `blkid` tag strings are exception-safe.** The `strdup()`'d UUID and
  label from `blkid_get_tag_value()` are now owned by a `unique_ptr` so they
  are freed even if a `std::string` assignment throws.
- **Windows: UTF-8/wide string conversions no longer write into the
  `std::string` terminator slot.** Conversion buffers are now sized to the
  full API-returned length (including the trailing NUL) and trimmed after.
- **`skipNetworkVolumes` is now honored.** The option was parsed but never
  applied. On Linux, `getVolumeMetadata()` now detects remote volumes from
  the mount table — before any filesystem IO that could hang — and returns
  shallow mount-table metadata (`status: "unknown"`, no `size`/`uuid`/
  `label`). Mount-point enumeration no longer health-probes remote volumes,
  and on macOS and Windows `getAllVolumeMetadata()` skips detailed queries
  for mount points whose fstype matches `networkFsTypes`. Path resolution
  (`getVolumeMetadataForPath()`, `getMountPointForPath()`) skips `stat()`ing
  remote mount points that aren't ancestors of the target, so a dead network
  mount can't hang lookups for unrelated local paths. The option is now
  accepted by the public `getVolumeMetadata()`, `getVolumeMetadataForPath()`,
  `getMountPointForPath()`, and `getVolumeMountPoints()` signatures.
- **Mounts with network fstypes but unparseable sources are now `remote`.**
  Remote detection keyed only on parsing the mount source, so a `9p` mount
  with a bare tag source, or a `davfs` mount with an `https://` URI, was
  reported `remote: false` (and would have dodged `skipNetworkVolumes`). The
  fstype now marks remote-ness too.
- **Windows: undefined behavior on non-ASCII path bytes.** Path security
  validation passed raw `char` values (negative for UTF-8 bytes ≥ 0x80) to
  `toupper()`/`isalpha()`; now cast through `unsigned char`.
- **Windows: concurrently-checked drives are no longer mislabeled `timeout`.**
  When one slow drive exhausted the shared enumeration budget, later drives
  whose checks had already completed were reported as timed out instead of
  their actual status.
- **Out-of-range `timeoutMs` values are rejected everywhere.** Native option
  parsing wrapped `timeoutMs: -1` into a ~50-day timeout via unsigned
  conversion (reachable on Windows, where the TypeScript timeout wrapper is
  bypassed, and from direct native calls); both the native parsers and the
  Windows bypass now enforce the same `[0, one day]` bound as the TypeScript
  wrapper, and validation runs before any native work is started.

## [2.0.0](https://github.com/PhotoStructure/fs-metadata/releases/tag/v2.0.0) (2026-06-03)

### Changed

- **BREAKING: Minimum supported Node.js raised to v22.** `engines.node` is now
  `>=22` (previously `>=20.0.0`). Node.js 20 and 21 are no longer supported. The
  supported matrix is now Node.js 22, 24, and 26. This drop is what makes the
  release a major version; there are no breaking changes to the public runtime
  API.

- **Dual type declarations for ESM and CommonJS.** The build now emits separate
  `index.d.cts` and `index.d.mts` declaration files, and the package `exports`
  map points each module system at its matching types. This fixes type
  resolution under `"moduleResolution": "node16"`/`"nodenext"` consumers. The
  build is now verified with [`@arethetypeswrong/cli`](https://arethetypeswrong.github.io/),
  and dual-declaration generation plus export checks (`check:exports`) run as
  part of the precommit/lint pipeline.

### Fixed

- **`statAsync` now passes `throwIfNoEntry`** to comply with the updated Node.js
  `fs.stat` signature, avoiding a deprecation/typing mismatch on newer runtimes.

## [1.4.1](https://github.com/PhotoStructure/fs-metadata/releases/tag/v1.4.1) (2026-04-27)

### Fixed

- **SIGABRT during Node.js environment teardown.** In-flight async workers
  (DiskArbitration/IOKit calls on macOS, and the equivalent paths on Linux
  and Windows) could complete after `node::FreeEnvironment` had begun
  teardown. The default `node-addon-api` completion path then threw a C++
  `Napi::Error` out of a libuv cleanup-hook frame with no catch, causing
  `terminate()` / abort.

  All async workers now derive from a new `SafeAsyncWorker` base that
  tracks per-env shutdown state via napi instance data plus
  `napi_add_env_cleanup_hook`. During teardown, completion callbacks
  short-circuit and deferred resolve/reject calls are wrapped to swallow
  teardown-time napi failures (the JS-side promise is unobservable at
  that point anyway). Long-running uncancellable native calls
  (`IOServiceGetMatchingService`, drive-status probes) also bail out as
  soon as the shutdown flag flips, so process exit isn't dragged out by
  in-flight work.

  No public API changes.

## [1.4.0](https://github.com/PhotoStructure/fs-metadata/releases/tag/v1.4.0) (2026-04-20)

### Removed

- **Linux GIO/GLib integration removed.** The optional `enable_gio` build-time
  flag, the `getGioMountPoints` native binding, and the entire `src/linux/gio_*`
  source tree have been deleted. The Linux mount-points and volume-metadata
  paths now use `/proc/self/mounts` parsing exclusively.

  Background: GIO was originally added to surface auto-mounted volumes (USB
  sticks, external SSDs) that appeared to be missing from `/proc/mounts`. The
  earlier mount-table read order has since been fixed, and direct verification
  on Ubuntu 24 confirmed that udisks2-mounted devices (`/media/$USER/...`) are
  fully visible via `/proc/self/mounts` without GIO. The remaining GIO code
  path was a thin wrapper around `g_unix_mounts_get()` (which itself reads
  `/proc/self/mountinfo`) — functionally redundant with the existing mtab
  parser. The GVolumeMonitor enrichment path that originally justified GIO had
  already been removed for thread-safety reasons in an earlier release.

  Net effect: smaller native module, no `libglib2.0-dev` build dependency, no
  `libgio` runtime dependency, simpler Linux build matrix. No public API
  changes — `getVolumeMountPoints()` and `getVolumeMetadata()` return the same
  data as before.

### Changed

- Linux build no longer requires `libglib2.0-dev`. Only `libblkid-dev` (and
  `uuid-dev` for the dev environment) is needed when compiling from source.
- `scripts/setup-native.mjs` removed — its only purpose was GIO autodetection.
  `npm run build` and `npm run build:native` no longer invoke it.

## [1.3.0](https://github.com/PhotoStructure/fs-metadata/releases/tag/v1.3.0) (2026-03-26)

### Added

- New optional `mountPoints` field on `Options`: pass pre-fetched mount points to `getMountPointForPath()` and `getVolumeMetadataForPath()` to avoid redundant system queries when resolving multiple paths. Obtain via `getVolumeMountPoints({ includeSystemVolumes: true })`.

## [1.2.0](https://github.com/PhotoStructure/fs-metadata/releases/tag/v1.2.0) (2026-03-26)

### Added

- New `getMountPointForPath(pathname)` function: a lightweight alternative to `getVolumeMetadataForPath()` that returns only the mount point string without fetching full volume metadata (size, UUID, label, etc.). On macOS, uses a single `fstatfs()` call — no DiskArbitration, IOKit, or space calculations. On Linux/Windows, uses the same device-ID matching logic. Handles symlinks and APFS firmlinks correctly.

## [1.1.0](https://github.com/PhotoStructure/fs-metadata/releases/tag/v1.1.0) (2026-03-16)

### Added

- New `getVolumeMetadataForPath(pathname)` function: given any file or directory path, returns the `VolumeMetadata` for the volume that contains it. Mirrors the behavior of `df pathname`:
  - Resolves POSIX symlinks via `realpath()`
  - On **macOS**: uses `fstatfs()` `f_mntonname` to correctly resolve APFS firmlinks (e.g. `/Users` → `/System/Volumes/Data`) — `stat().dev` does not follow firmlinks and would give the wrong result
  - On **Linux**: uses `stat().dev` device ID matching with path-prefix disambiguation for bind mounts and GIO mounts that share a device ID. Also works correctly in Docker containers, where `/proc/self/mounts` reflects the container's mount namespace.
  - On **Windows**: uses device ID and path-prefix matching against logical drives

- New `isReadOnly` field on `MountPoint` (and by extension `VolumeMetadata`) indicating whether a volume is mounted read-only. This is useful for identifying volumes with unstable UUIDs, like the macOS APFS system snapshot at `/`, whose UUID changes on every OS update. Available on all platforms:
  - **macOS**: reads `MNT_RDONLY` from `statfs` flags
  - **Linux**: parses `ro` from mount options in `/proc/mounts`
  - **Windows**: checks `FILE_READ_ONLY_VOLUME` from `GetVolumeInformation`

### Changed

- **macOS `isSystemVolume` detection now uses APFS volume roles via IOKit** instead of path pattern heuristics. Each APFS volume has a role (System, Data, VM, Preboot, Recovery, etc.) stored in its superblock. We read this via `DADiskCopyIOMedia()` → `IORegistryEntryCreateCFProperty("Role")`, with a `MNT_SNAPSHOT` fallback if DiskArbitration is unavailable. This is factual (Apple assigns the roles), not heuristic, and correctly distinguishes:
  - `/` (System role) → `isSystemVolume: true` — sealed OS snapshot, unstable UUID
  - `/System/Volumes/Data` (Data role) → `isSystemVolume: false` — primary user data volume
  - `/System/Volumes/VM`, `Preboot`, `Update`, `Hardware`, `xarts`, etc. → `isSystemVolume: true`
  - See [`doc/system-volume-detection.md`](./doc/system-volume-detection.md) for full details

### Security

- macOS: RAII wrapper (`IOObjectGuard`) for IOKit objects in APFS volume role detection, preventing Mach port resource leaks if exceptions occur during `GetApfsVolumeRole()`
- macOS: DiskArbitration operations in `getVolumeMountPoints()` now serialize through the same `g_diskArbitrationMutex` used by `getVolumeMetadata()`, preventing potential data races when both APIs are called concurrently
- See [`doc/SECURITY_AUDIT_2026.md`](./doc/SECURITY_AUDIT_2026.md) for full audit details

### Fixed

- Zero-initialized `VolumeMetadata` size/used/available fields to prevent uninitialized values when volume info retrieval fails early
- Windows: eliminated redundant `GetVolumeInformationW` call per drive in `getVolumeMountPoints()`

### Removed

- Removed macOS `/System/Volumes/*` path patterns from `SystemPathPatternsDefault` — these are now handled natively via APFS volume roles. The Spotlight, FSEvents, and Trashes glob patterns (`**/.Spotlight-V100`, `**/.fseventsd`, etc.) were also removed as they matched directories within volumes, not mount points.

## [1.0.1](https://github.com/PhotoStructure/fs-metadata/releases/tag/v1.0.1) (2026-03-01)

### Fixed

- `isHidden()` and `getHiddenMetadata()` now return `false` for root directories on all platforms. Windows root drives (e.g. `C:\`) have `FILE_ATTRIBUTE_HIDDEN` set by default as a system quirk, not user intent.

## [1.0.0](https://github.com/PhotoStructure/fs-metadata/releases/tag/v1.0.0) (2026-02-23)

### Security

- Windows: add `/NXCOMPAT` (DEP) and `/HIGHENTROPYVA` (x64 high-entropy ASLR) linker flags
- Windows: add `WarningLevel: 4` as structured MSBuild property on x64 and ARM64 targets (avoids `/W` flag ordering conflicts with node-gyp defaults)
- Linux/macOS: add `-D_FORTIFY_SOURCE=2` and `-Wformat-security` compiler flags
- Linux x64: add `-fcf-protection=full` (Intel CET); Linux ARM64: add `-mbranch-protection=standard` (PAC+BTI)

## [0.9.0](https://github.com/PhotoStructure/fs-metadata/releases/tag/v0.9.0) (2025-12-28)

### Added

- New `networkFsTypes` option for configuring network filesystem detection
- `NetworkFsTypesDefault` and `SkipNetworkVolumesDefault` exports

### Changed

- Expanded `SystemFsTypesDefault` with `bpf`, `tracefs`, `nsfs`, `ramfs`, `rpc_pipefs`, `fuse.lxcfs`, `fuse.portal`
- Expanded `SystemPathPatternsDefault` with macOS metadata paths, kubelet, LXC/LXD, Flatpak paths
- `isRemoteFsType()` and `extractRemoteInfo()` accept optional `networkFsTypes` parameter

## [0.8.1](https://github.com/PhotoStructure/fs-metadata/releases/tag/v0.8.1) (2025-12-28)

### Changed

- Added container runtime paths to the default set of system paths. See SystemPathPatternsDefault

## [0.8.0](https://github.com/PhotoStructure/fs-metadata/releases/tag/v0.8.0) (2025-12-01)

### Added

- `FS_METADATA_TIMEOUT_MS` environment variable for configuring operation timeout (see [gotchas.md](./doc/gotchas.md))

### Security

- Fixed TOCTOU race condition in macOS hidden file operations by using `fstat()`/`fchflags()` with file descriptors instead of path-based `stat()`/`chflags()`

### Fixed

- Added `O_CLOEXEC` flag to `open()` calls to prevent fd leaks on fork/exec
- Fixed logic bug attempting to convert invalid CFStringRef in `ProcessNetworkVolume`
- Fixed inconsistent `status` field when DiskArbitration returns partial results
- Added `noexcept` to all RAII destructors to prevent `std::terminate` during stack unwinding
- Removed `GVolumeMonitor` from Linux GIO metadata enrichment to fix thread safety issues
- Fixed exception safety in Linux GIO metadata loop using RAII smart pointers
- Fixed Windows `FindFirstFileEx` handle leak by using `FindClose` instead of `CloseHandle`
- Fixed Windows promise race condition and resource leak from detached timeout threads
- Added `CreateEvent` error checking in Windows thread pool
- Zero-initialized `VolumeInfo` and `DiskSpaceInfo` members to prevent undefined behavior on `ERROR_NOT_READY`

### Changed

- Extracted shared `FdGuard` RAII class to `common/fd_guard.h`
- Extracted shared `WouldOverflow()` utility to `common/volume_utils.h`
- Moved `path_security.h` to `common/` (POSIX-portable)
- Simplified CFString null-terminator handling using `strlen()`
- Documented intentional static dispatch queue singleton pattern
- Consolidated Linux GIO RAII helpers (`GFilePtr`, `GVolumePtr`, etc.) in `gio_utils.h`
- Added move semantics to `BlkidCache` for proper resource transfer

## [0.7.1](https://github.com/PhotoStructure/fs-metadata/releases/tag/v0.7.1) (2025-10-29)

- Audit and address [several resource handling issues](./doc/SECURITY_AUDIT_2025.md)
- Added support for Node.js v25
- Updated dev dependencies

## 0.6.0 (2025-06-09)

### Added

- Comprehensive memory testing framework with Valgrind and AddressSanitizer support
- Thread safety tests for Windows platform
- Platform-specific build scripts with automatic OS detection
- Clang-tidy integration for C++ code analysis
- Worker thread helper for volume metadata operations
- NAPI_VERSION=9 definition for improved compatibility
- Dynamic test timeout configuration based on environment (CI, platform, architecture)
- Prebuild script for Linux GLIBC compatibility in Docker environments

### Breaking

- Dropped support for Node.js v18, added support for Node.js v24

### Changed

- Simplified ESM/CJS dual module support with unified build configuration
- Enhanced test coverage with additional error handling and edge case tests
- Updated all imports to use `node:` prefix for built-in modules
- Reorganized build and test scripts for better clarity
- Improved memory test workflow for cross-platform compatibility
- Renamed native module target from `node_fs_meta` to `fs_metadata` for consistency

### Fixed

- Added path validation to prevent directory traversal vulnerabilities in hidden file operations
- Improved error handling and null checks across Linux GIO implementation
- Fixed buffer allocation issues in Windows networking and volume operations
- Enhanced resource management with better validation for empty mount points
- Made `SystemPathPatternsDefault` values visible in TypeScript typings
- Added Napi::HandleScope to OnOK and OnError methods for proper scope management
- Removed unnecessary std::move operations in worker implementations
- Resolved CI test reliability issues across different environments, particularly Alpine ARM64 emulation timeouts

## [0.4.0](https://github.com/PhotoStructure/fs-metadata/releases/tag/0.4.0) (2025-01-09)

- `Fixed`: Switch to thread-safe `getmntinfo_r_np()` for macOS. Improved darwin resource management.

## [0.3.3](https://github.com/PhotoStructure/fs-metadata/releases/tag/0.3.3) (2025-01-08)

- `Packaging`: Improved ESM/CJS support with common `__dirname` implementation thanks to `tsup` [shims](https://tsup.egoist.dev/#inject-cjs-and-esm-shims).

  This change simplifies the implementation and improves inline js docs as the exported code and docs have been inlined.

- `Packaging`: Re-enabled test coverage assertions (after finding the magics to get istanbul to see what the tests were exercising)

- `Packaging`: Added debuglog tests

- `Packaging`: Fixed `npm run watch`

## [0.3.2](https://github.com/PhotoStructure/fs-metadata/releases/tag/0.3.2) (2025-01-03)

- `Fixed`: prior `canReaddir()` (and subsequent `status` of volume metadata) would incorrectly fail if the first directory element wasn't readable.

## [0.3.1](https://github.com/PhotoStructure/fs-metadata/releases/tag/0.3.1) (2025-01-03)

No public codepath updates.

- `Fixed`: updated regex patterns for improved matching and linting compliance

- `Fixed`: flaky CI test on macOS

- `Added`: GitHub Action CodeQL and addressed linting nits

- `Added`: scripts for **manually** running `clang-tidy` and `snyk code test` (as they both emit spurious warnings that don't seem to be safely silenced)

## [0.3.0](https://github.com/PhotoStructure/fs-metadata/releases/tag/0.3.0) (2025-01-01)

- `Changed`: For consistency, [Options.systemFsTypes](https://photostructure.github.io/fs-metadata/interfaces/Options.html#systemfstypes) is now a `string[]` (it was a `Set<string>`)

## 0.2.0 (2025-01-01)

- `Changed`: Add `**/#snapshot` to the list of "system" volumes

- `Changed`: Add sourcemaps and source typescript to the npm pack

- `Fixed`: macOS system mount points are now filtered properly

## 0.1.0 (2024-12-17)

First release! Everything is a new feature!

The 1.0.0 release will happen after some integration testing with the native
library payloads, but the API should be stable after the first release.
