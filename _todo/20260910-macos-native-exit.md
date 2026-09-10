# TPP: macOS native operations must not block process exit

## Summary

Move macOS volume metadata, mount enumeration, and mount-path lookup off
libuv's worker pool. Node's default process.exit() joins that pool, so promise
timeouts and environment cleanup flags cannot release a wedged OS call.
Preserve timeoutMs: 0 as unlimited without an unlimited libuv waiter.

## Current phase

- [x] Research and design alternatives
- [x] Deterministic regression tests
- [x] Implementation
- [x] Validation and review
- [x] Cross-model second opinion after review fixes

Implementation and reviews are complete. Release and PhotoStructure dependency
updates remain separate work.

## Required reading

AGENTS.md, CONTRIBUTING.md, doc/gotchas.md, doc/C++_REVIEW_TODO.md,
doc/MACOS_API_REFERENCE.md, doc/system-volume-detection.md,
src/common/shutdown.h, src/darwin/{volume_metadata,volume_mount_points,get_mount_point}.cpp.

## Design decisions and critiques

1. Detached calls with AsyncWorker waiting on a future: finite timeouts help,
   but zero pins libuv again. Rejected. A timed DA mutex alone does not free
   the first wedged worker.
2. ThreadSafeFunction delivery: avoids libuv work, but releasing the TSFN on
   environment teardown requires coordination with late native completion.
   Prefer event-loop polling of plain C++ state: detached threads never touch
   N-API or libuv, including after cancellation or environment teardown.
3. Unlimited detached jobs: turns pool exhaustion into native thread/memory
   exhaustion. Use at most four executing jobs and 256 queued jobs per addon
   image, prune cancelled queued work, and bound existing access probes too.
   DA mutex acquisition checks cancellation/deadline in short timed waits.

Each request owns a libuv timer and an asynchronous environment cleanup hook.
Completion or timeout closes the timer; teardown closes it without joining
native threads. The close callback removes the cleanup hook before deleting
the event-loop-owned request. Native jobs hold no JS handles or environment.
Their results are published with release/acquire synchronization. Pin the
addon image before creating detached threads; process-lifetime synchronization
and logging state must survive static teardown.

Mac path resolution must move realpath/stat to native too. Metadata's native
directory open replaces its redundant JS opendir, and mount access probes
perform the directory check so enumeration does not repeat it on libuv.
System-volume classification and Linux/Windows behavior stay unchanged.

## Validation

Use a test-only dyld interposer to block a real DA/IOKit call after writing a
readiness signal. Child tests cover process.exit with finite and zero timeout,
natural exit after timeout, independent libuv I/O, bounded admission, worker
environment teardown, and late completion after teardown. No dead shares,
global network changes, or readiness sleeps. Run macOS native build, CJS/ESM
tests, type checks, clang-tidy, exports/docs, and memory checks. The preflight
script updates dependencies; run its validation commands on the locked versions
instead of introducing unrelated dependency updates.

### Results

- Before rebuilding, the blocked-DA unlimited-metadata regression reproduced
  the original hang: readiness arrived, but the child needed the 10-second
  SIGKILL watchdog after calling `process.exit()`.
- The interposer now covers DA, IOKit, realpath, and opendir. Regression tests
  also cover finite and zero deadlines, natural exit after timeout, independent
  libuv I/O with `UV_THREADPOOL_SIZE=1`, bounded admission, reuse of a stalled
  directory probe across snapshots, and late completion after termination of
  the addon's last Worker environment.
- CJS and ESM full suites each pass 684 tests across 51 suites (84 tests and
  13 platform-specific suites skipped), including 12 exit-isolation tests and
  five error-property tests.
- Native build and fresh compilation database pass. clang-tidy reports no
  warnings across all 24 native source/header files. TypeScript and ESLint pass.
- Distribution build and package exports pass. TypeDoc passes with the existing
  `HideMethods` documentation warning.
- All six standalone memory-growth tests pass. The full ASan/UBSan suite,
  including all 17 shutdown/error regression tests, passes with the matching
  Apple toolchain. macOS `leaks` reports zero leaks/zero leaked bytes. The normal
  addon build has been restored. Final logs are in
  `/tmp/fs-metadata-review-final-{tests,lint,build,asan}.log`; standalone memory
  output is in `/tmp/fs-metadata-memory.log`.
- Independent native-lifetime review found no remaining defects. Full-suite
  testing exposed a foreign-realm native Error compatibility change after
  removal of the JS directory check. A VM probe reproduced it with both the
  old and new addons; normalize native rejections in the public path/metadata
  wrappers and preserve errno properties. Regression tests cover this.

macOS platform checks must run outside this filesystem sandbox: inside it,
`DASessionCreate` returns null and system-volume metadata becomes partial.
This is a sandbox restriction, not a native build failure. The tsx CLI also
needs local IPC permission. No dependencies or release versions were changed.

### Cross-model second opinion

Scope: the complete working-tree diff against
`2348dfbd23376b73c856b4a1cc3b763636b4f109`, including new files. Codex reviewed
independently while Claude Opus 5 (`xhigh`) ran the shared single-pass method.
Claude session: `92f88058-a4a5-4756-b27f-6f62da21ede3`. Authentication works
outside the Codex filesystem sandbox; the initial sandboxed login failure was
an environment failure, not a review result.

The first Claude pass returned LAND with one Medium finding: native filesystem
errors dropped Node's `errno`, `syscall`, and `path` properties. Accepted after
comparing the same missing-path and non-directory inputs against Node's
`fs.realpath` and `fs.opendir`. Four new regression tests failed before the fix.
Native jobs now retain the syscall/path as C++ strings and expose a negative
libuv errno when constructing the JS error. The four tests compare against
Node's actual filesystem errors and pass; their comments contain the exact
reference commands.

During post-review validation, Codex found a second Medium issue: the shutdown
tests assumed `build/Release/fs_metadata.node`, but macOS CI downloads only
prebuild artifacts. `npm run build:native` also moves the binary to prebuilds.
Reproduced all 12 shutdown tests failing with MODULE_NOT_FOUND in an isolated
temporary package containing only prebuilds. The tests now use
`node-gyp-build.path()` without loading the addon in the parent, preserving the
last-Worker-owner test. No production loader behavior changed.

Claude's second complete pass returned REVISE with one Medium finding: the
restored `path` field used the canonicalized path after a successful realpath,
while Node and the previous JS directory check retained the caller's path.
Accepted after comparing Node/open and the public metadata API on the same
directory-symlink fixture. Removing fixture canonicalization and adding an
explicit directory symlink produced two failing path-parity assertions.
Metadata's basic-info helper now receives the original requested path for
error reporting; path lookup also uses its original input for error fields.
The filesystem calls still operate on validated paths. CJS and ESM now each
pass 684 tests across 51 suites; all 17 shutdown/error tests pass in the
prebuilt-only fixture, and the five error-property tests compare directly with
Node. TypeScript, ESLint, and all 24 clang-tidy checks pass. The final full
ASan/UBSan run passes all 684 tests and macOS `leaks` reports zero leaks/zero
leaked bytes. The normal build is restored.

The third complete Claude pass returned **LAND: no issues found**. Codex's
complete reread also found no additional issues. Claude independently repeated
the full suites, lint, prebuilt-only tests, and 60 rounds of Worker termination
with four active native queries, followed by a successful main-environment
query. Local checks used Node 24; the Node 22/26 matrix remains for CI. All
temporary review/build copies were removed. No commit or release was made.

Final verdict: **LAND**. No findings were vetoed.

| Scope                    | Model         | Finding                               | Severity | Accept/Veto   | Evidence                                                                                           | Verdict |
| ------------------------ | ------------- | ------------------------------------- | -------- | ------------- | -------------------------------------------------------------------------------------------------- | ------- |
| Native filesystem errors | Claude Opus 5 | Missing errno/syscall/path            | Medium   | Accept, fixed | Four tests failed before the fix; fields now match Node fs errors.                                 | LAND    |
| Shutdown tests           | Codex         | Hardcoded build path fails in CI      | Medium   | Accept, fixed | Old path failed all 12 tests in a prebuilt-only package; all 17 current tests pass there.          | LAND    |
| Native filesystem errors | Claude Opus 5 | Canonical path replaced caller's path | Medium   | Accept, fixed | Same-input Node comparison and two failing assertions confirmed it; all five error tests now pass. | LAND    |

One earlier sanitizer run aborted with duplicate registration of the
`GetHiddenWorker` vtable during Worker addon loading. It did not reproduce in
the 16 focused sanitizer tests, ten sequential Worker-only load/unload probes,
or either subsequent full sanitizer run. No code or sanitizer flags were changed for the first replay;
its cause is undetermined. Preserve this observation rather than treating the
passing replay as an explanation. The failing output remains in
`/tmp/fs-metadata-review-asan.log`, and focused runs are in
`/tmp/fs-metadata-review-asan-{targeted,workers}.log`.
An isolated sanitizer build also completed 100 sequential volume-query Workers
(each its addon's only owning environment) without a diagnostic. Its output is
`/tmp/fs-metadata-review-asan-volume-workers.log`. Both failing registration
stacks enter through Node's DLOpen and contain no PinAddon frame; this narrows
the observation but does not establish its cause.

### Additional Astra review

At the user's request, Astra (`gpt-6-astra`, `xhigh`) independently reviewed
the same complete 29-file working-tree scope against `2348dfbd23376b73c856b4a1cc3b763636b4f109`.
The installed standalone Codex CLI could not start that model because its
version was too old; the actual review ran in a fresh task-local Astra
subagent using the complete shared single-pass method and pasted requirements.
It received no prior reviewer conclusions. Codex also reread the full patch.

Astra returned **LAND: no issues found**. Its focused exit/error run passed
16 of 17 tests inside the sandbox. The remaining IOKit case could not reach
its blocking hook there; an author-run check with normal macOS access passed
with unchanged code and build:

```sh
npm run test:cjs -- --no-coverage --runInBand src/darwin-native-exit.test.ts -t 'blocked IOKit call'
```

That run passed one test (11 skipped), seed `1861897320`, in 1.763 seconds.
There were no findings to accept or veto and no review-driven code edits.
The earlier sanitizer observation remains unresolved as documented above.
Temporary review files were removed. The implementation remains uncommitted.

### Packaging review R817-A

The user supplied another Claude review returning LAND with one Medium
packaging observation: npm's source-file whitelist included the test-only
dyld interposer. Accepted after `npm pack --dry-run --json --ignore-scripts`
confirmed 53 files including `src/test-utils/darwin-blocking-interposer.cpp`.
The header's "Never linked into the published addon" claim was already true;
the issue was unnecessary source distribution, not a demonstrated runtime
security defect.

Added `!src/test-utils/**` to the package's `files` whitelist. Repeating the
pack dry run returned 52 files. A before/after file-set assertion confirmed
that the interposer was the only removal and every production source and
artifact remained included. No native code or test behavior changed.

| Scope | Model | Finding | Severity | Accept/Veto | Evidence | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| npm package contents | Claude (user-supplied review) | R817-A: test interposer source shipped | Medium | Accept, fixed | Pack dry run changed from 53 to 52 files; exact file-set comparison found only the interposer removed. | LAND |

### Local sanitizer setup

The first sanitizer run mixed the PATH's Homebrew Clang 22 compiler with the
script's Apple Clang 21 runtime and failed in ASan image initialization. Use a
matching toolchain, including this machine's explicit SDK path:

```sh
SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk \
CC=/Library/Developer/CommandLineTools/usr/bin/clang \
CXX=/Library/Developer/CommandLineTools/usr/bin/clang++ \
bash scripts/macos-asan.sh
```

ASan also removes `DYLD_INSERT_LIBRARIES` from the running Node environment.
The new subprocess test launcher recovers the loaded sanitizer path from
`process.report` and includes it when launching children. Without that, the
children failed during runtime initialization before reaching the test. No
sanitizer checks or compiler hardening flags were disabled.

## Lore

- Baseline 2348dfb, package 2.5.0. Both relevant DA workers match PhotoStructure's
  installed 2.5.0. The previous checkout was stale (2.2.1).
- PhotoStructure separately supervises Node/Electron child termination. Its
  new preflight child lacks a parent deadline; that application change is a
  separate task. This change does not isolate arbitrary application fs calls.
- Publishing/release and PhotoStructure dependency updates are separate from
  implementing this patch; follow doc/RELEASING.md for an eventual release.
