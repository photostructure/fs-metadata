# TPP: Volume mount subscriptions

## Summary

Add a cross-platform polling subscription for mount-point additions and
removals. Callers configure the polling interval in milliseconds; the default
is 60,000 ms. Snapshots must avoid capacity and health collection, never
overlap underlying scans, and work in Node Workers as ordinary TypeScript state
owned by each environment. Linux may classify each newly observed local target
once to preserve the existing directory-only contract.

## Current phase

- [x] Research & Planning
- [x] Write breaking tests
- [x] Design alternatives
- [x] Task breakdown
- [x] Implementation
- [x] Review & Refinement
- [x] Final Integration
- [x] Review

## Required reading

- `AGENTS.md`
- `CONTRIBUTING.md`
- `doc/gotchas.md`
- `doc/TPP-GUIDE.md`
- `doc/C++_REVIEW_TODO.md`
- `doc/system-volume-detection.md`
- `doc/MACOS_API_REFERENCE.md`
- `doc/LINUX_API_REFERENCE.md`
- `doc/WINDOWS_API_REFERENCE.md`
- `src/volume_mount_points.ts`
- `src/linux/mount_points.ts`
- `src/darwin/volume_mount_points.cpp`
- `src/windows/volume_mount_points.cpp`
- `src/types/native_bindings.ts`
- `src/index.ts`

## Description

Consumers currently have to call `getVolumeMountPoints()` repeatedly and
implement their own diffing, lifecycle, error retention, and timer behavior.
Expose a Node-style watcher that establishes an initial snapshot and emits
atomic batches containing added and removed `MountPoint` records. Its observed
universe must match the library's current mount-point enumeration, including
the existing Windows drive-root limitation. This is an eventually consistent
state observer, not a lossless mount-operation audit log.

Accessibility status, filesystem integrity, physical-device health, and free
space do not belong in the recurring topology snapshot. Capacity thresholds
are tracked by the separate available-space TPP.

## Lore

- The public option is `pollIntervalMs`, in milliseconds. It defaults to
  60,000 and must be finite, integral, positive, and within Node's timer range.
- Use self-scheduling `setTimeout`, scheduled after a scan settles. Do not use
  `setInterval`: a slow scan must not overlap or build a queue.
- The initial snapshot is returned by `watcher.ready`; existing mounts are not
  manufactured as additions.
- A failed later snapshot emits an error, retains the last good snapshot, and
  retries after the normal interval. It never reports all mounts removed.
- The watcher observes mount paths visible to the current process/session. A
  complete mount/unmount cycle between samples can be missed.
- Linux currently reads `/proc/self/mounts`. `/proc/self/mountinfo` would
  improve move/overmount identity, but changing the canonical parser is a
  separate compatibility-sensitive project. The watcher must initially match
  `getVolumeMountPoints()` rather than create a divergent mount universe.
- Windows shallow enumeration is already safe: `skipHealthProbes` uses only
  `GetLogicalDriveStringsW`. It observes drive roots, including session-visible
  mappings, but not directory-mounted volume paths.
- macOS now forwards `skipHealthProbes` into `GetVolumeMountPointsWorker`, so
  watcher scans stop after `getmntinfo_r_np(MNT_NOWAIT)` and classification,
  without `faccessat` probes.
- Linux shallow enumeration cannot distinguish directory targets from file bind
  targets. The implementation therefore probes each newly observed local path
  once, including the initial set. It tracks the raw uncancellable probe after
  a caller-visible timeout so scans cannot overlap. Remote paths are retained
  without probing. Cached target visibility is discarded when a path leaves
  the raw mount table so a later path-type replacement is classified again.
- `timeoutMs` bounds each caller-visible snapshot without bounding the raw
  native/filesystem promise used for overlap prevention. A timed-out recurring
  snapshot reports through `lastError` and an attached `error` listener, then
  waits for the raw work before scheduling another poll. Linux directory probes
  retain their quarter-budget so they can report before the outer deadline.
- Windows shallow enumeration cannot evaluate a custom `systemFsTypes` filter.
  The watcher rejects that option on Windows instead of silently returning a
  differently filtered universe.
- Shallow internal enumeration currently suppresses TypeScript system-volume
  assignment. The watcher should request all entries, clone/classify them, and
  then apply its requested system-volume filter without changing path-resolution
  behavior.
- Native notifications are future invalidation hints only: Linux mount-table
  polling, macOS FSEvents mount/unmount flags, and Windows Configuration Manager
  volume-interface notifications all have different coverage and still require
  snapshot reconciliation.
- Authoritative references:
  - Linux mount table: https://man7.org/linux/man-pages/man5/proc_pid_mountinfo.5.html
  - Apple FSEvents mount flag: https://developer.apple.com/documentation/coreservices/kfseventstreameventflagmount
  - Windows drive roots: https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getlogicaldrivestringsw
  - Node timers: https://nodejs.org/api/timers.html
- `close()` and abort must win even when an already-resolved initial scan queued
  its microtask first. The shared watcher checks both the race result and its
  current closed state before committing the baseline.
- Caller-visible timeouts do not prove raw filesystem work ended. Initial and
  recurring scans carry a separate settlement promise; `ready` may resolve from
  the visible baseline, but no timer is armed until raw work has settled.
- The repository's `npm run preflight` is intentionally mutating: it upgrades
  dependencies and replaces `package-lock.json`. Final integration ran its
  non-mutating lint, docs, distribution, export, native build, CJS/ESM, and
  memory/sanitizer gates directly instead.

## Solutions

### Iteration 1: Native event backends

Implement a different persistent OS notification source per platform.

**Pros:** Low-latency delivery and little idle polling.

**Cons:** Linux device events do not equal namespace mount changes; macOS Disk
Arbitration callbacks do not equal mount/unmount; Windows PnP notifications miss
mapped and substituted drives. All three still need repair snapshots and
substantial Worker teardown code.

**Decision:** Rejected for v1. Preserve as a later dirty-hint optimization.

### Iteration 2: Poll the existing public function

Call `getVolumeMountPoints()` at a configurable interval and diff paths.

**Pros:** Very small implementation and automatically follows existing filters.

**Cons:** Public enumeration performs accessibility probes. Repeating it can
touch dead network mounts and consume native/thread-pool resources. It also
returns dynamic statuses that do not belong in topology identity.

**Decision:** Rejected because idle subscription cost and failure isolation are
core requirements.

### Iteration 3: Reconciled shallow snapshots (preferred)

Use the existing internal `skipHealthProbes` route, repair macOS option
plumbing, classify/filter shallow snapshots in TypeScript, and diff immutable
records by normalized mount path.

**Pros:** One shared public contract; no capacity or health-status collection;
additive API; simple deterministic tests; clean `close`/`ref`/`unref` behavior;
future native hints can trigger the same reconciler.

**Cons:** Detection latency is bounded by the configured interval. A same-path
volume replacement between samples is not distinguishable on Windows without
performing additional volume I/O. Linux needs one tracked directory probe for
each newly observed local path to preserve file-target filtering.

**Decision:** Selected. User feedback requires a millisecond interval option
and favors a low-impact one-minute default.

## Tasks

- [x] Add deterministic tests for baseline readiness, add/remove batches,
      unchanged snapshots, snapshot error retention, no overlap, close,
      abort, and timer `ref`/`unref` behavior.
- [x] Add source coverage proving macOS forwards `skipHealthProbes` and bypasses
      accessibility probes in shallow mode.
- [x] Add shared polling-interval validation and the 60,000 ms default.
- [x] Implement the watcher/reconciler in TypeScript with an injected snapshot
      source for deterministic tests.
- [x] Expose `watchVolumeMountPoints`, watcher/change types, documentation, and
      an example from `src/index.ts`.
- [x] Repair macOS `skipHealthProbes` plumbing using the existing native option
      and worker; do not add persistent native resources.
- [x] Verify TypeScript, ESLint, TypeDoc, CJS, ESM, Linux native build and lint,
      package exports, focused tests, and memory/Valgrind/ASan/UBSan/TSan gates.
      The mutating dependency-update portion of `npm run preflight` was not run.
- [x] Run the repository review workflow, resolve verified findings, update
      this TPP, and archive it under `_done/`.

## Post-completion cross-platform validation

Validated on 2026-08-05 from isolated temporary trees containing local `HEAD`
plus only this feature's files. Neither development worktree was modified.

- Apple Silicon `m1`: macOS 26.5.2, arm64, Node 24.18.1. Native build,
  TypeScript, ESLint, distribution declarations, package exports, and native
  clang-tidy all passed. Focused subscription tests passed 36/36. Full CJS and
  ESM each passed 647 tests with 84 platform skips. JavaScript memory checks,
  ASan, UBSan, and the macOS `leaks` tool passed with zero leaked bytes.
- Windows `swift`: Windows x64, Node 24.19.0. Native build, TypeScript, ESLint,
  distribution declarations, and package exports passed. Focused CJS and ESM
  subscription tests passed 36/36; ESM open-handle detection was clean. Full
  CJS and ESM each passed 660 tests with 68 platform skips, including Windows
  memory and handle checks. The standalone six-test memory suite passed.
- Windows clang-tidy completed all 12 files and repeated 11 pre-existing
  first-party warnings. The changed `volume_mount_points.cpp` had only the
  existing Node-API worker-ownership diagnostic on its allocation expression;
  the new shallow enumeration and drive-list retry logic produced no diagnostic.
- The complete Windows ESM suite printed Jest's one-second asynchronous-exit
  warning after passing. The feature's focused ESM suites passed separately
  under `--detectOpenHandles` with no reported handle, so the warning was not
  attributable to these subscriptions.

## Post-stage review follow-up

On 2026-08-06, review found that `timeoutMs` was accepted but did not bound a
watcher's caller-visible topology snapshot. The watcher now validates the value
before scanning and applies it to the visible snapshot while retaining the raw
settlement promise for overlap prevention. Deterministic tests cover initial
and recurring timeouts, error state, and the lack of overlap after a timeout.
The same review clarified the documented Windows record shape as `mountPoint`
plus TypeScript-derived `isSystemVolume`; probe-derived fields are absent.

Local focused CJS and ESM suites each passed 31/31 after the fix. TypeScript,
ESLint, and TypeDoc passed; TypeDoc repeated only the pre-existing `HideMethods`
warning. A targeted rerun on Apple Silicon `m1` passed its native build,
TypeScript, ESLint, and focused CJS/ESM suites (30 passed with one expected
Linux-only skip in each module mode). The previously completed full Windows `swift` validation
still covers the native and shared polling implementation; an additional
post-review transfer was blocked before execution by the environment's remote
source-transfer guard, so no newer Windows result is claimed.
