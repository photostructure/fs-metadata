# TPP: Available-space threshold subscriptions

## Summary

Add a separate cross-platform subscription that observes whether a path's
volume has at least a caller-selected number of bytes available. Polling is
configured in milliseconds and defaults to 60,000 ms. Emit transitions only,
support hysteresis, never overlap capacity probes, and keep unavailable/error
states distinct from “below threshold.”

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
- `doc/MACOS_API_REFERENCE.md`
- `doc/LINUX_API_REFERENCE.md`
- `doc/WINDOWS_API_REFERENCE.md`
- `src/volume_metadata.ts`
- `src/types/volume_metadata.ts`
- `src/async.ts`
- `src/index.ts`

## Description

Capacity changes are frequent and fundamentally different from topology
changes. Expose a watcher for the boolean condition “available bytes are at
least this minimum,” rather than streaming every observed byte count. The
initial state is returned through `ready`; listeners receive only crossings.

The implementation should use Node's cross-platform `fs.promises.statfs()` so
each poll asks only for filesystem counters rather than repeating labels,
UUIDs, Disk Arbitration, libblkid, or network identity work. It must preserve
this library's `available = bavail * blockSize` semantics.

## Lore

- `minimumAvailableBytes` is required and non-negative.
- `pollIntervalMs` defaults to 60,000 ms and uses the same validation and
  self-scheduling timer behavior as the topology watcher.
- `hysteresisBytes` defaults to zero. A below-threshold state recovers only at
  `minimumAvailableBytes + hysteresisBytes`; this prevents flapping.
- A timeout or stat failure is an error/unknown observation, never zero bytes
  and never a threshold transition.
- A timed-out filesystem operation is not cancelled by JavaScript. Do not
  schedule another probe until the original underlying promise settles, or a
  dead network mount could consume the libuv pool one request per interval.
- The package's supported Node 22+ releases provide `fs.promises.statfs()`.
- Use `bavail`, not `bfree`. APFS volumes in a shared container can legitimately
  report the same capacity, and dynamic values must never be tested for exact
  equality against the live filesystem.
- Authoritative references:
  - Node `statfs`: https://nodejs.org/api/fs.html#fspromisesstatfspath-options
  - POSIX `statvfs`: https://man7.org/linux/man-pages/man3/statvfs.3.html
  - libuv Windows `statfs`: https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c
  - Windows caller-available structure: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fscc/63768db7-9012-4209-8cca-00781e7322f5
- `timeoutMs` is public, defaults through `getTimeoutMsDefault()`, and is
  validated like the library's other filesystem timeouts. It reports an error
  promptly but cannot cancel the underlying Node filesystem request.
- `close()` and abort settle a pending `ready` immediately, including the
  already-resolved-promise microtask race, while late raw rejections remain
  handled. No recurring timer starts until the initial raw request settles.
- The repository's `npm run preflight` upgrades dependencies and replaces
  `package-lock.json`. Final integration ran its non-mutating constituent gates
  directly so this feature did not introduce unrelated dependency changes.

## Solutions

### Iteration 1: Include capacity in topology snapshots

**Pros:** One watcher and one callback surface.

**Cons:** Capacity changes constantly, forcing noisy events and expensive
per-volume calls. One dead volume would tax unrelated topology observation.

**Decision:** Rejected. Capacity is a separate concern and subscription.

### Iteration 2: Poll full `getVolumeMetadata()`

**Pros:** Exactly reuses current public metadata and timeout behavior.

**Cons:** Repeats UUID, label, filesystem, remote, and platform-specific
identity work when only `available` is needed. This is unnecessarily taxing for
a long-lived watcher.

**Decision:** Rejected for the default implementation.

### Iteration 3: Focused `statfs` threshold observer (preferred)

Use `fs.promises.statfs(path)` and an injected probe in tests. Convert
`bavail * bsize` to the package's number-valued byte convention, apply a state
machine with hysteresis, and emit only crossings.

**Pros:** Cross-platform Node stdlib; no native rebuild for the watcher itself;
minimal per-poll work; independently configurable; deterministic unit tests.

**Cons:** Like existing filesystem metadata calls, a network provider can
remain blocked after the caller-visible timeout. The watcher must suppress
additional probes until it settles.

**Decision:** Selected. User feedback requires a public millisecond interval
and favors a one-minute default.

## Tasks

- [x] Add deterministic tests for initial above/below states, both crossings,
      hysteresis, equality boundaries, unchanged samples, errors, timeouts,
      no-overlap-after-timeout, close, abort, and `ref`/`unref`.
- [x] Add shared polling-interval validation and lifecycle support, reusing the
      topology watcher infrastructure where that improves clarity.
- [x] Implement the focused `statfs` available-byte probe with overflow and
      result validation appropriate to the existing number-valued API.
- [x] Expose `watchAvailableSpace` and its state/change/watcher types from
      `src/index.ts`, with documentation and an example.
- [x] Verify TypeScript, ESLint, TypeDoc, CJS, ESM, focused tests, package
      exports, and memory/Valgrind/ASan/UBSan/TSan gates. The mutating
      dependency-update portion of `npm run preflight` was not run.
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
  first-party warnings. None was in the TypeScript `statfs` threshold watcher.
- The complete Windows ESM suite printed Jest's one-second asynchronous-exit
  warning after passing. The feature's focused ESM suites passed separately
  under `--detectOpenHandles` with no reported handle, so the warning was not
  attributable to these subscriptions.
