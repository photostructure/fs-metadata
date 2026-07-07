# TPP: Security-review fixes — per-concern commit plan

**Status:** ✅ Windows validated (14/14 per-commit compile on x64, tip 537
tests, behavioral checks pass). Rebased onto the updated `origin/main` (which
gained `5c34b0b fix(path): reject Windows device-namespace paths` — a
pre-existing bug the Windows Claude found + pushed; touches only `src/path.ts`,
orthogonal to the 14, conflict-free rebase). New topology:
`5c34b0b → bdd322f (btrfs changelog) → 14 commits → tip 132bdcb`. ✅ **PUSHED
to origin/main 2026-07-06** as a fast-forward; final tip **b8ddfe5** (adds one
`chore(volume_metadata)` commit fixing the pre-existing C5333 comment
line-continuation warning MSVC flagged). Validated Linux 507 / macOS 522 /
Windows 537 + behavioral checks. (Shas below predate the nit-fix and rebase
re-shings, but commit content and order are unchanged. This TPP is now
reference-only; move to `_done/` when convenient.) Three scope-review nits
were folded in before landing: darwin `set_value`-under-lock (commit 4), stale
`GetDiskFreeSpaceExW` comment (commit 6), and the `we rely on native bindings`
comment-deletions moved from commit 13 into commit 12. Re-validated per-commit
on Linux (14/14 tsc+native, tip 507) and macOS (14/14, tip 522); `git diff HEAD`
touches only the (excluded) btrfs `_todo`. The commit-by-commit plan and
hunk-staging mechanics below are retained for reference / re-landing.

**Date:** 2026-07-05 (fixes span 7 intern review rounds, 2026-07-04..05)

## Context

An external "intern" review of the native code ran in 7 rounds; every accepted
finding is fixed in the current working tree. The CHANGELOG (2.1.0 → `### Fixed`)
describes each fix. Validation already performed:

- **Linux (this box):** `node-gyp rebuild` clean (0 warnings), `npm run tests`
  (CJS + ESM, 507 passed each), `lint:tsc`, `lint:eslint`, `lint:native`
  (clang-tidy), `check:memory` (valgrind/ASAN/LSan) — all pass. The
  empty-mountPoint abort repro (exit 134) now throws `TypeError`.
- **macOS (`ssh MAC_BOX`, tree synced at `~/src/fs-metadata`):** native compiles
  clean, `npm run tests` 522 passed × CJS + ESM. Note: node/npm are at
  `/usr/local/bin` (need `export PATH=/usr/local/bin:$PATH` for
  non-interactive ssh).
- **Windows: NOT validated** — see `_done/20260705-windows-validation.md`.

**Do NOT include in any commit:**

- `_todo/20260704-btrfs-zfs-subvolume-uuid.md` — tracked file with leftover
  modifications from the btrfs session (deleted upstream in 9752a96 context);
  belongs to the user, not this work.
- `_done/20260705-*.md` (these handoff docs) unless the user asks.

**Rules:** Conventional Commits; no Co-Authored-By/Claude attribution; ASK THE
USER before `git commit` (they have approved "one commit per concern" for this
work, but confirm before starting) and before any `git push`.

## Validation performed (2026-07-06)

The full 14-commit split was **materialized and validated per-commit** in an
isolated linked worktree on branch `scratch/secreview-validate` (base 9752a96)
— the working tree and `main` were never touched. Key results:

- **Tip == working tree:** applying all 14 commits reproduces the current
  working tree byte-for-byte (every work file, btrfs `_todo` correctly
  excluded). So the split changes nothing in aggregate vs. the already-tested
  tree.
- **Linux (this box):** 14/14 commits `tsc --noEmit` PASS + `node-gyp build`
  PASS; tip full suite 507 pass. (Native build compiles linux/ + common/, so
  commits 5/10/11/12 — incl. the intra-file splits of `linux/volume_metadata.cpp`
  and `common/volume_metadata.h` — are really compiled at each intermediate.)
- **macOS (MAC_BOX):** 14/14 commits `tsc` + native PASS; tip full suite 522 pass.
  (Native compiles darwin/ + common/, so commits 4/5's darwin C++ intermediate
  states are really compiled.)
- **Windows:** the only remaining gap — 7 commits (1,2,3,6,7,8,9) touch only
  Windows C++ and were never compiled. Per-commit recipe + the hand-engineered
  split-boundary invariants are documented in
  `_done/20260705-windows-validation.md`. Branch is fetchable from LINUX_BOX
  or via `/home/USER/secreview-validate.bundle` (2.7M self-contained).
- **Semantic scope review (14 agents, one per commit):** every commit —
  files-as-expected, scope-matches, message-accurate, **zero cross-commit
  leakage**. 13 "clean", 1 "minor". The only "minor" (commit 13): the two
  `// we rely on the native bindings on Windows...` comment deletions in
  `volume_metadata.ts`/`volume_mount_points.ts` are really tied to commit 12's
  `validateTimeoutMs` change, not skipNetworkVolumes — harmless scope creep;
  optionally move those two deletions into commit 12 when landing. Agents also
  independently confirmed the hand-engineered boundaries compile-reason cleanly
  (no duplicate `widePath`/`written`, `IsSystemVolume` overload+call-sites land
  together in 7, `wDebugPrefix` only referenced internally, timeoutMs tests
  restored without duplication). Non-blocking code nits noted (not split
  defects): pre-existing stale `GetDiskFreeSpaceExA` comment (commit 6 context)
  and a narrow probe-dedup race irrelevant to hung mounts (commit 4 code).

Mechanics: intermediate contents were generated by applying pick_hunks subsets
to BASE (`scratchpad/gen_intermediates.sh`, with a full-reconstruction sanity
check per split file), then staged whole-file per commit
(`scratchpad/materialize.sh`). The one intra-hunk split (windows/volume_metadata.cpp
hunk 18, commit 6 vs 7) was built backward from final to avoid the duplicate-
`widePath` ambiguity. **These scratch commits are a validation artifact**; the
actual landing on `main` still follows the hunk-staging mechanics below once
the review loop is cleared.

## Commit sequence

Order matters for compilability of intermediate commits (Windows files can't
be compile-checked locally — preserve the constraints below). Four files are
split across commits at hunk level; every other file is `git add`ed whole in
exactly one commit.

### 1. `fix(string)` — NUL-slot conversion buffers

Files: `src/windows/string.h` (whole);
`src/windows/security_utils.h` — ONLY the `SafeStringToWide` hunks
(allocation `requiredSize`, `int written`, `result.resize(...)`).

```
fix(string): size Windows string-conversion buffers to include the terminating NUL

WideCharToMultiByte/MultiByteToWideChar were told the buffer held the full
returned size while the std::string only provided size-1 writable chars, so
the APIs' NUL landed in the string's terminator slot — inside the
allocation, but formally undefined behavior. Allocate the full size and trim
the NUL after converting.
```

### 2. `fix(security_utils)` — ctype UB

Files: `src/windows/security_utils.h` — remaining hunks (the
`std::transform`/`toupper` lambda + comment, and the
`std::isalpha(static_cast<unsigned char>(...))` change).

```
fix(security_utils): avoid ctype undefined behavior on non-ASCII path bytes

toupper()/isalpha() were given raw char values; any UTF-8 byte >= 0x80 is
negative as a signed char, which is undefined behavior for the C ctype
functions (and trips debug-CRT asserts on MSVC). Cast through unsigned char.
```

### 3. `fix(thread_pool)` — shutdown UAF

Files: `src/windows/thread_pool.h` (whole).

```
fix(thread_pool): prevent use-after-free during Windows pool shutdown

WaitForMultipleObjects fails outright past MAXIMUM_WAIT_OBJECTS (64)
handles — hardware_concurrency() exceeds that on large machines — and the
unchecked result let Shutdown() free ThreadData that running workers still
dereference. Clamp the pool to 64 threads and free per-thread state only
once a worker has confirmably exited, deliberately leaking hung workers'
state instead.
```

### 4. `fix(darwin)` — accessibility probes

Files: `src/darwin/volume_mount_points.cpp` (whole — the probe redesign,
per-path in-flight dedup, thread-ctor exception cleanup, single
`wait_until(deadline)` budget, and `timeoutMs 0` = no timeout all belong to
this one concern).

```
fix(darwin): keep hung access probes from pinning or leaking native threads

std::async futures block in their destructor, so a faccessat() hung on a
dead network mount pinned the mount-point worker even after its timeout was
reported. Probe via promise + detached thread instead, deduplicate in-flight
probes per path (repeated polling of a hung mount reuses its stuck probe
rather than accumulating threads, and thread-construction failure removes
the map entry so it cannot poison later calls), and give the whole probing
phase a single timeoutMs deadline so N dead mounts cost one budget, not N.
wait_until with an expired deadline still polls, so completed probes report
their real status; timeoutMs 0 disables the timeout as documented.
```

### 5. `fix(volume_metadata)` — native abort on bad input

Files: `src/darwin/volume_metadata.cpp` (whole);
`src/common/volume_metadata.h` — ONLY the empty-mountPoint hunk
(`if (options.mountPoint.empty()) throw Napi::TypeError...`);
`src/linux/volume_metadata.cpp` — ONLY the ctor hunk (removal of the
`std::invalid_argument` throw) and the `GetVolumeMetadata` entry hunk;
`src/windows/volume_metadata.cpp` — ONLY the `GetVolumeMetadata` entry hunk;
`src/native_binding_validation.test.ts` — WITHOUT the two `timeoutMs` tests
(negative + above-one-day). Easiest: temporarily Edit those two `it(...)`
blocks out, `git add`, commit, then restore them (they land in commit 12).

```
fix(volume_metadata): throw a JS TypeError instead of aborting on bad input

node-addon-api only translates Napi::Error, so the std::invalid_argument
thrown for an empty mountPoint escaped the N-API entry point and killed
Node with SIGABRT (exit 134). Validate mountPoint in FromObject and require
an options object at each platform entry point; adds direct-native
regression tests.
```

### 6. `fix(windows)` — wide-char APIs

Files: `src/windows/drive_status.h` — ONLY the `CheckDriveInternal` W-API hunk
(`SafeStringToWide` searchPath, `WIN32_FIND_DATAW`, `FindFirstFileExW`);
`src/windows/volume_metadata.cpp` — the `<vector>` include, `WNetConnection`
rewrite, `VolumeInfo` rewrite, `DiskSpaceInfo` rewrite, the
`std::wstring widePath = ...` hoist + `VolumeInfo volInfo(widePath)` +
`DiskSpaceInfo diskInfo(widePath)` + `GetDriveTypeW`, and the REMOVAL of the
old `std::wstring widePath = ...` declaration in the IsSystemVolume region.

**Constraints:** keep `CheckDriveStatus(mountPoint)` WITHOUT the timeout arg
(that's commit 8) and keep the two-arg
`IsSystemVolume(widePath, volInfo.isValid() ? volInfo.getFlags() : 0)` call +
its "pre-fetched flags" comment (that's commit 7). The old inline widePath
declaration MUST be removed here or the intermediate commit declares widePath
twice and won't compile.

```
fix(windows): use wide-char APIs so Unicode paths and labels survive

JS strings are UTF-8, but FindFirstFileExA / GetVolumeInformationA /
GetDiskFreeSpaceExA / GetDriveTypeA / WNetGetConnectionA interpret bytes in
the active ANSI code page, mangling or rejecting non-ANSI mount points,
volume labels, and UNC share names. Convert once per call at the JS
boundary and use the W APIs end-to-end.
```

### 7. `fix(system_volume)` — NTFS false positives

Files: `src/windows/system_volume.h` (whole);
`src/windows/volume_mount_points.cpp` (whole);
`src/windows/volume_metadata.cpp` — remaining IsSystemVolume hunk (comment
lines removed, `metadata.isSystemVolume = IsSystemVolume(widePath);`);
`doc/system-volume-detection.md` (whole).

```
fix(system_volume): stop marking every NTFS data drive as a system volume

The "system volume" capability flags 0x00100000/0x00200000 are actually
FILE_SEQUENTIAL_WRITE_ONCE and FILE_SUPPORTS_TRANSACTIONS — the latter is
set on every local NTFS volume, so all data drives were reported
isSystemVolume: true (masked by includeSystemVolumes defaulting to true on
Windows). Rely on the Windows-directory drive check plus the TypeScript
SystemDrive fallback, and drop the invented flag names and dead overload.
```

### 8. `fix(drive_status)` — honor timeoutMs, 0 disables

Files: `src/windows/drive_status.h` — the `CheckDrive` `timeoutMs == 0` hunk
and the `CheckMultipleDrives` `timeoutMs == 0` hunk (NOT the poll hunk —
commit 9); `src/windows/volume_metadata.cpp` — final hunk
(`CheckDriveStatus(mountPoint, options_.timeoutMs)`). File reaches final
state.

```
fix(drive_status): honor timeoutMs, and let 0 disable timeouts as documented

getVolumeMetadata ignored options.timeoutMs for its drive-status check
(always using the 5s default), and native code treated timeoutMs 0 as an
immediate timeout even though the API docs (and the TypeScript withTimeout
wrapper) define 0 as disabling the timeout.
```

### 9. `fix(drive_status)` — don't mislabel ready drives

Files: `src/windows/drive_status.h` — remaining hunk (drop the
`remainingMs == 0 ||` short-circuit; comment about polling). File reaches
final state.

```
fix(drive_status): poll ready futures before declaring enumeration timeouts

CheckMultipleDrives shares one elapsed budget across concurrently-launched
checks, but consumed results in order: when a slow drive exhausted the
budget, later drives whose checks had already completed were reported as
Timeout without being looked at. wait_for(0) polls, so completed checks now
report their real status even after the budget is spent.
```

### 10. `fix(debug_log)` — thread safety

Files: `src/common/debug_log.h` (whole).

```
fix(debug_log): synchronize debug state across threads

enableDebugLogging and debugPrefix are written from the JS thread and read
from async worker threads; an unsynchronized prefix write can reallocate
the string mid-read. Make the flag atomic, guard the prefix with a mutex,
and drop the unused (and non-ASCII-broken) wDebugPrefix.
```

### 11. `fix(linux)` — blkid exception safety

Files: `src/linux/volume_metadata.cpp` — remaining hunks (`<cstdlib>` include

- the blkid `unique_ptr` rewrite). File reaches final state.

```
fix(linux): free blkid tag values even if a string assignment throws

blkid_get_tag_value() returns strdup()'d memory that leaked if the
std::string assignment threw; hold it in unique_ptr<char, decltype(&free)>.
```

### 12. `fix(async)` — timeoutMs validation everywhere

Files: `src/async.ts` (whole); `src/common/volume_utils.h` (whole —
`MAX_TIMEOUT_MS`); `src/common/volume_mount_points.h` (whole);
`src/common/volume_metadata.h` — remaining hunks (`volume_utils.h` +
`<cstdint>` includes, timeout range-check hunk) → final;
`src/mount_point_for_path.ts` (whole);
`src/volume_metadata.ts` — ONLY the import-line change
(`validateTimeoutMs` added to the `./async` import), the
`getVolumeMetadataImpl` validate hunk, and the `getVolumeMetadataForPathImpl`
validate hunk; `src/volume_mount_points.ts` — ONLY the `./async` import-line
change and the `getVolumeMountPointsImpl` validate hunk;
`src/native_binding_validation.test.ts` — final (restore the two timeoutMs
tests removed in commit 5).

```
fix(async): validate timeoutMs consistently across TS, native, and platforms

timeoutMs escaped validation on several routes: native parsing wrapped
negative values into ~50-day timeouts via Uint32Value(), the Windows paths
bypass withTimeout() entirely, custom opts.mountPoints skipped it on the
path-resolution APIs, and fractional values just over the one-day cap
slipped through TS flooring while native compared the raw double. Extract
validateTimeoutMs() (raw-value range check, [0, one day], 0 disables), run
it before any work starts on every public route, and mirror the same bound
in the native option parsers via MAX_TIMEOUT_MS.
```

### 13. `fix(volume_metadata)` — honor skipNetworkVolumes

Files: `src/volume_metadata.ts` — remaining hunks → final (mtab-before-
directoryStatus reorder + skip short-circuit, getAllVolumeMetadata
enumeration skip, findMountPointByDeviceId non-ancestor skip);
`src/volume_mount_points.ts` — remaining hunks → final (option type,
`isRemoteFsType` import, enumeration health-probe filter);
`src/linux/mtab.ts`, `src/linux/mtab.test.ts`, `src/types/options.ts`,
`src/index.ts`, `src/skip_network_volumes.test.ts` (all whole).

```
fix(volume_metadata): honor skipNetworkVolumes instead of parsing and ignoring it

The option existed since 0ab3b55 but nothing read it. On Linux,
getVolumeMetadata() now reads the mount table before touching the mount
point and returns shallow mtab-derived metadata (status "unknown", no
size/uuid/label) for remote volumes; remote-ness also keys off fstype so 9p
tags and davfs URIs that don't parse as remote sources are still caught
(the old davfs test expectation was itself wrong). Mount-point enumeration
skips health-probing remote fstypes, getAllVolumeMetadata() skips detailed
queries for them on macOS/Windows, and path resolution skips stat()ing
non-ancestor remote mount points (ancestors are still statted — skipping
them would break lookups on healthy network mounts). Public signatures for
getVolumeMetadata, getVolumeMetadataForPath, getMountPointForPath, and
getVolumeMountPoints now accept the relevant options. Windows drive letters
mapped to network shares report the server's filesystem (typically NTFS),
so mapped drives may still be probed — documented limitation.
```

### 14. `docs(changelog)`

Files: `CHANGELOG.md` (whole).

```
docs(changelog): record security-review fixes for 2.1.0
```

## Hunk-staging mechanics

The worktree must never change; stage hunk subsets into the index:

1. `git diff -U0 -- <file> > step.patch` (worktree vs index; regenerating
   after each commit automatically accounts for already-staged hunks).
2. Select hunks with the helper below (indices are 1-based in file order):
   `python3 pick_hunks.py step.patch 2 5 > subset.patch`
3. `git apply --cached --unidiff-zero subset.patch`
4. **Verify with `git diff --cached -- <file>` before committing** — a
   mis-numbered zero-context hunk applies at the wrong place silently (this
   happened once; the renumbering in the script below fixes it, but verify).
5. After the final commit: `git status --short` must show only the untracked
   `_done/20260705-*.md` docs and the modified btrfs `_todo` file;
   `git diff HEAD` must be empty except those.
6. Rebuild + `npm run tests` at HEAD as a final check.

A copy of `pick_hunks.py` (renumbers `+start` offsets for skipped hunks so
`--unidiff-zero` applies correctly):

```python
#!/usr/bin/env python3
import re, sys

path = sys.argv[1]
wanted = {int(a) for a in sys.argv[2:]}
lines = open(path).read().splitlines(keepends=True)
HUNK_RE = re.compile(
    r"^@@ -(?P<os>\d+)(?:,(?P<oc>\d+))? \+(?P<ns>\d+)(?:,(?P<nc>\d+))? @@(?P<rest>.*)$"
)
groups, current_hunk = [], None

def close_hunk():
    global current_hunk
    if current_hunk is not None:
        groups[-1][1].append(current_hunk)
        current_hunk = None

for line in lines:
    if line.startswith("diff "):
        close_hunk(); groups.append(([line], []))
    elif line.startswith(("index ", "--- ", "+++ ", "old mode", "new mode")):
        close_hunk()
        if not groups: groups.append(([line], []))
        else: groups[-1][0].append(line)
    elif line.startswith("@@"):
        close_hunk(); current_hunk = [line]
    elif current_hunk is not None:
        current_hunk.append(line)
close_hunk()

n, out = 0, []
for hdr, hunks in groups:
    selected, skipped_delta = [], 0
    for h in hunks:
        n += 1
        m = HUNK_RE.match(h[0].rstrip("\n"))
        oc = int(m.group("oc")) if m.group("oc") is not None else 1
        nc = int(m.group("nc")) if m.group("nc") is not None else 1
        if n in wanted:
            ns = int(m.group("ns")) - skipped_delta
            selected.append([f"@@ -{m.group('os')},{oc} +{ns},{nc} @@{m.group('rest')}\n"] + h[1:])
        else:
            skipped_delta += nc - oc
    if selected:
        out.extend(hdr)
        for h in selected: out.extend(h)
missing = wanted - set(range(1, n + 1))
if missing:
    sys.stderr.write(f"ERROR: out of range: {sorted(missing)} (total {n})\n"); sys.exit(1)
sys.stdout.write("".join(out))
```

For the new-file split (`native_binding_validation.test.ts`, commits 5/12),
temporary Edit + `git add` + restore is simpler than intent-to-add patching.

## After landing

- Follow up with `_done/20260705-windows-validation.md` (critical — Windows
  code is compile-unverified) and `_done/20260705-macos-validation.md`.
- MAC_BOX (`ssh MAC_BOX`, `~/src/fs-metadata`) holds an rsynced copy of this worktree;
  after push, reset it to origin to de-drift (it also received a stray copy
  of the btrfs `_todo` file).
