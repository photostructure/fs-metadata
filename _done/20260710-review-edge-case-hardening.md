# TPP: Review edge-case hardening

## Summary

Resolve nine review findings covering mount-table escape parsing, end-to-end
filesystem timeouts, Windows drive-probe isolation, empty-volume handling,
system-path glob case sensitivity, hidden-file validation, and reliable ASan
failure propagation.

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
- `doc/LINUX_API_REFERENCE.md`
- `doc/MACOS_API_REFERENCE.md`
- `doc/WINDOWS_API_REFERENCE.md`
- `doc/system-volume-detection.md`
- Review findings and every affected source/test file

## Description

Normal tests, TypeScript checks, memory stress tests, and Valgrind currently
pass, but review identified reproducible inputs that may corrupt parsed paths,
misclassify valid paths or volumes, silently accept invalid operations, permit
public promises to exceed their timeout, exhaust Windows probe capacity, or
let CI miss sanitizer failures. Every confirmed finding needs a deterministic
regression test and the smallest cross-platform-safe correction.

## Lore

- All nine findings are verified against current source.
- Linux mount/fstab whitespace escapes are fixed-width octal (`\040`, `\011`),
  so a decoder must consume exactly three octal digits. udev by-label escapes
  use fixed-width `\xNN` bytes. Greedy decoding corrupts following digits.
  Reference: https://man7.org/linux/man-pages/man5/fstab.5.html
- A TypeScript outer `withTimeout()` is the only small, cross-platform way to
  bound the complete public operation. It cannot cancel a blocked OS/libuv
  worker, but it covers `realpath()`, initial `stat()`, device matching, and
  every later native Windows metadata call with one caller-visible deadline.
- Windows `FindFirstFileExW(root + "*")` returns no handle when there is no
  matching child. `ERROR_FILE_NOT_FOUND` therefore means an empty but
  accessible root; `ERROR_PATH_NOT_FOUND` remains inaccessible.
  Reference: https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-findfirstfileexw
- The custom Windows drive-check pool was fixed at `hardware_concurrency()`
  (maximum 64), while timed-out tasks keep their worker indefinitely. Windows'
  callback pool plus `CallbackMayRunLong()` provides replacement capacity for
  long-running callbacks and removes that fixed starvation threshold.
  Reference: https://learn.microsoft.com/en-us/windows/win32/api/threadpoolapiset/nf-threadpoolapiset-callbackmayrunlong
- `CancelSynchronousIo()` is best-effort and Microsoft warns that canceling a
  reused pool thread can race with a later operation. A custom cancellation/
  retirement pool is substantially more complex; a killable helper process is
  the only hard boundary for providers that ignore cancellation.
  Reference: https://learn.microsoft.com/en-us/windows/win32/fileio/canceling-pending-i-o-operations
- Clang documents that an ASan finding prints a report and exits nonzero. CI
  must propagate the test pipeline status and fail on any unsuppressed
  `ERROR: AddressSanitizer`/`ERROR: LeakSanitizer` header; attribution to one
  same-line project frame is not a sound gate.
  Reference: https://clang.llvm.org/docs/AddressSanitizer.html
- Nearby documentation is stale: `doc/gotchas.md` says one thread per Windows
  volume; the Windows API reference overstates `future.wait_for()` and
  misdescribes `FIND_FIRST_EX_ON_DISK_ENTRIES_ONLY`; the C++ review checklist
  marks the fixed-pool issue complete.

## Solutions

### Option A (preferred): outer deadlines + adaptive Windows callbacks

- Decode only three-digit octal and two-digit hex escapes; emit canonical
  three-digit octal escapes while preserving Unicode.
- Wrap complete path-resolution and metadata promises at their public impl
  boundary.
- Replace the fixed drive-check pool with `TrySubmitThreadpoolCallback()` and
  call `CallbackMayRunLong()` before the potentially blocking probe.
- Interpret wildcard `ERROR_FILE_NOT_FOUND` as a healthy empty root.
- Make glob regexes case-insensitive only on Windows.
- Validate hide methods at runtime and check path existence before deriving
  dot-prefix hidden state.
- Propagate the sanitizer test pipeline status and reject every unsuppressed
  sanitizer report; test the report classifier with multiline fixtures.

Pros: smallest change that directly covers each review finding; no unsafe
thread termination; no new runtime dependency; consistent public timeout
semantics. Cons: outer deadlines do not cancel underlying syscalls, and the
Windows system pool is adaptive rather than a hard resource boundary.

### Option B: custom cancellable/replacing Windows pool

Track the exact worker for every probe, cancel queued tasks, call
`CancelSynchronousIo()` for running tasks, retire that worker, and spawn a
replacement. This offers more scheduler control, but cancellation is still
best-effort and safe implementation needs a task-state machine, admission
control, repeated-path coalescing, shutdown redesign, and protection against
cancellation racing with worker reuse.

### Option C: killable helper process

Run blocking Windows probes out-of-process and terminate the helper at the
deadline. This is the only hard cancellation boundary, but requires protocol,
packaging, startup, security, and lifecycle changes disproportionate to the
current module and review scope.

## Tasks

- [x] Verify each review finding against current source and authoritative docs.
- [x] Add regression tests for confirmed TypeScript/POSIX behavior.
- [x] Add test seams/regressions for Windows behavior that cannot be exercised
      on Linux CI.
- [x] Make sanitizer failures reliably affect the script exit status.
- [x] Implement the selected timeout/isolation design.
- [x] Run targeted and full verification, including native/memory checks where
      supported by the current host.
- [x] Review final diff and archive this TPP under `_done/`.

## Verification

- Targeted regression suites: 178 passed, 3 skipped.
- Full CommonJS suite: 529 passed, 76 skipped.
- Full ESM suite: 529 passed, 76 skipped.
- `npm run lint:tsc`, `npm run lint:eslint`, `npm run lint:native`,
  `npm run docs`, `npm run build:dist`, and `npm run check:exports` passed.
- `npm run check:memory` passed all JavaScript memory checks, Valgrind with
  zero errors, and the complete ASan/LSan test run.
- Independent TypeScript, Windows-native, and sanitizer reviews found no
  remaining issues after their verified findings were corrected.
- Windows-native compilation was not available on the Linux host; source-level
  regression tests lock the reviewed Windows contracts for Windows CI.
