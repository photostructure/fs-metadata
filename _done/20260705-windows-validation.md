# TPP: Windows validation of security-review fixes

**Status:** The 14 commits are **LANDED on local main** (base 9752a96, tip
fdfe506) but **NOT pushed** — the origin push waits on this Windows validation
(validate-before-push, so an intermediate-commit break can be fixed with a
clean rebase). Validated per-commit on Linux (14/14 tsc+native, tip 507) and
macOS (14/14, tip 522). Every commit's native code is compiled **except the 7
Windows-only commits (1,2,3,6,7,8,9)** — never compiled, never run. That gap
is what this pass closes (a Claude on the Windows dev laptop).

**✅ DONE (2026-07-06):** Windows x64 validated — 14/14 per-commit compile,
tip 537 tests, `check:memory` 6/6, and behavioral checks pass (system-volume
false-positive fixed: `C:`→true / `P:`→false; Unicode label `фото西` intact;
`timeoutMs:0` completes; clean shutdown). Network-drive degradation + ARM64 +
a 2nd-Unicode-removable were NOT exercised (no hardware). A **pre-existing**
device-path bypass (`\\.\CON` etc., failing at base 9752a96) was found and
fixed separately as `5c34b0b`. The whole batch is pushed to origin/main
(tip b8ddfe5). CI will cover ARM64.

## Per-commit chain validation (added 2026-07-06)

### Get the commits onto the Windows box

The 14 commits are on **local main** on LINUX_BOX (base 9752a96, tip fdfe506)
and in a 2.7M self-contained bundle. Fetch them into a local branch
`secreview-validate` so the per-commit loop below works unchanged:

- **Fetch from LINUX_BOX** (outbound ssh from Windows):
  `git fetch ssh://USER@LINUX_BOX/home/USER/src/fs-metadata main:secreview-validate`
- **Or via bundle:** `scp USER@LINUX_BOX:/home/USER/secreview-validate.bundle .`
  then `git fetch ./secreview-validate.bundle main:secreview-validate`
  (bundle sha1 `bd796cf875a5985d0f813e1bc338f5f8e133eac4`, tip fdfe506;
  self-contained, unbundles regardless of the local clone's state).

Use a separate worktree so the main checkout is untouched:
`git worktree add ../secreview-wt secreview-validate`.

### The 14 commits (base 9752a96)

| #   | sha     | commit                                                 | native compiled?            |
| --- | ------- | ------------------------------------------------------ | --------------------------- |
| 1   | 9446071 | fix(string): NUL-slot conversion buffers               | **Windows-only**            |
| 2   | 22dae34 | fix(security_utils): ctype UB                          | **Windows-only**            |
| 3   | 79a8fd3 | fix(thread_pool): shutdown UAF, clamp to 64            | **Windows-only**            |
| 4   | 3112d2d | fix(darwin): access probes (+set_value-under-lock nit) | macOS ✓                     |
| 5   | f02466a | fix(volume_metadata): abort→TypeError                  | mac/Linux ✓ + **win entry** |
| 6   | edac15c | fix(windows): wide-char APIs (+ExW comment nit)        | **Windows-only**            |
| 7   | 42d1b59 | fix(system_volume): NTFS false-positive                | **Windows-only**            |
| 8   | 63812d0 | fix(drive_status): honor timeoutMs, 0 disables         | **Windows-only**            |
| 9   | 87efaab | fix(drive_status): poll ready futures                  | **Windows-only**            |
| 10  | 952a120 | fix(debug_log): thread safety                          | Linux ✓                     |
| 11  | d9431f6 | fix(linux): blkid exception safety                     | Linux ✓                     |
| 12  | f7c3e23 | fix(async): timeoutMs validation                       | mac/Linux ✓                 |
| 13  | d2f9317 | fix(volume_metadata): skipNetworkVolumes               | (TS)                        |
| 14  | fdfe506 | docs(changelog)                                        | (docs)                      |

### Per-commit build loop (git-bash)

Use the project's known-good Windows native build (`npm run build:native` sets
the CL arch defines — see CLAUDE.md "Build Architecture Issue"; plain
`node-gyp build` fails with "No Target Architecture"). Symlink/point
node_modules from the main checkout to avoid a reinstall.

```bash
cd ../secreview-wt   # worktree on secreview-validate
BASE=$(git rev-parse secreview-validate~14)
for sha in $(git rev-list --reverse "$BASE..secreview-validate"); do
  git checkout -q "$sha"
  ./node_modules/.bin/tsc --noEmit   && echo "tsc  OK $sha" || echo "tsc  FAIL $sha"
  npm run build:native >/dev/null 2>&1 && echo "nat  OK $sha" || echo "nat  FAIL $sha"
done
git checkout -q secreview-validate
npm run tests   # full suite at the tip
```

Building all 14 is thorough; if pressed for time the load-bearing Windows
compiles are commits **5, 6, 7, 8, 9** (the split-file boundaries below).
Commits 1–3 change whole Windows files, so their state == the tip for those
files and `npm run tests` at the tip covers them.

### Intermediate-compilability invariants to watch

A _mid-chain_ Windows build failure is almost certainly at one of these
hand-engineered split boundaries (Linux/macOS could not check them):

- **Commit 5 — `windows/volume_metadata.cpp`:** ONLY the `GetVolumeMetadata`
  entry point changes (reject non-object args → `Napi::TypeError`;
  `auto options = FromObject(...)`). The rest of the file is still BASE
  (A-APIs) — it must compile with the new entry + old body.
- **Commit 6 — `windows/volume_metadata.cpp` + `drive_status.h` (the big
  wide-char rewrite).** Invariants at THIS commit:
  - `widePath` is declared **exactly once** in the metadata worker (hoisted
    near `VolumeInfo`); the old duplicate decl in the IsSystemVolume region
    is removed here. Two decls → won't compile (this was the trickiest split).
  - `IsSystemVolume` is still called with **two args**
    `IsSystemVolume(widePath, volInfo.isValid() ? volInfo.getFlags() : 0)`,
    and `system_volume.h` still has both overloads (the one-arg switch is
    commit 7).
  - `CheckDriveStatus(mountPoint)` is still called **without** the timeoutMs
    arg (commit 8 adds it).
  - `drive_status.h` here has only `FindFirstFileExW` / `WIN32_FIND_DATAW` /
    `SafeStringToWide(searchPath)` — no timeoutMs==0 handling, no poll change.
  - `WideToUtf8` (used here) is the pre-existing helper in `string.h`
    (finalized in commit 1) — available.
- **Commit 7 — `system_volume.h` (drops the 2-arg overload) +
  `volume_mount_points.cpp` + `volume_metadata.cpp` IsSystemVolume region →
  one-arg `IsSystemVolume(widePath)`.** The overload removal and every
  call-site switch land together in this single commit — the boundary most
  likely to break if the split were wrong.
- **Commit 8 — `drive_status.h`** timeoutMs==0 early-returns +
  `volume_metadata.cpp` `CheckDriveStatus(mountPoint, options_.timeoutMs)`.
- **Commit 9 — `drive_status.h`** drops the `remainingMs == 0 ||`
  short-circuit (ready-future polling).

## Access problem (blocker)

The available Windows box has an ssh **client** but no **sshd**, and the
`WINDOWS_BOX` entry in `~/.ssh/config` (WINDOWS_BOX) is unreachable (no ping,
2026-07-05). Options, in order of preference:

1. **Enable the built-in OpenSSH Server** (Windows 10/11 optional feature).
   In an elevated PowerShell on the Windows box:

   ```powershell
   Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
   Set-Service -Name sshd -StartupType Automatic
   Start-Service sshd
   ```

   Key auth gotcha: for users in the Administrators group, the key goes in
   `C:\ProgramData\ssh\administrators_authorized_keys` (NOT
   `~\.ssh\authorized_keys`), and that file must be ACL-restricted to
   Administrators + SYSTEM or sshd ignores it. Install the pubkey from this
   Linux box (`~/.ssh/SSH_KEY.pub`). Confirm the drive/port is reachable
   from LINUX_BOX; sshd's setup normally adds the firewall rule itself.
   Default shell is cmd.exe — fine for `ssh winbox "cd /d C:\... && npm test"`
   style commands as long as node is on the system PATH.

2. **If inbound to the box is blocked** (different subnet/VPN): reverse
   tunnel from the Windows box to this Linux host (sshd still required on
   Windows, listening on localhost only is fine):
   `ssh -R 2222:localhost:22 USER@LINUX_BOX` — then from Linux:
   `ssh -p 2222 <winuser>@localhost`.

3. **No-sshd fallback (manual round-trips):** the box's ssh client is enough
   for git. On Windows:
   `git remote add LINUX_BOX ssh://USER@LINUX_BOX/home/USER/src/fs-metadata`
   then after the commit plan lands locally:
   `git fetch LINUX_BOX && git checkout LINUX_BOX/main` (or the branch), then run
   the checklist below and paste output back to the session. Slower, but
   zero setup.

## What changed on Windows (see CHANGELOG 2.1.0 § Fixed)

| File                                       | Change                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `src/windows/string.h`, `security_utils.h` | conversion buffer sizing; ctype casts                                                                 |
| `src/windows/thread_pool.h`                | pool clamp to 64; exit-checked shutdown, leak-not-UAF                                                 |
| `src/windows/drive_status.h`               | `FindFirstFileExW`; timeoutMs honored, 0 = disabled; ready-future polling                             |
| `src/windows/system_volume.h`              | capability-flag check removed (was marking every NTFS drive a system volume)                          |
| `src/windows/volume_metadata.cpp`          | all W APIs; widePath hoist; `CheckDriveStatus(mountPoint, options_.timeoutMs)`; entry-point TypeError |
| `src/windows/volume_mount_points.cpp`      | `IsSystemVolume(widePath)` call site                                                                  |
| `src/common/*.h`                           | shared: mountPoint/timeoutMs validation, debug-log thread safety, `MAX_TIMEOUT_MS`                    |

## Validation checklist

Build:

- [ ] `npm ci && npm run build:native` (prebuildify wrapper sets the `CL`
      arch defines — see CLAUDE.md "Build Architecture Issue"). x64 at
      minimum; ARM64 if available.
- [ ] Zero new compiler warnings in the touched files.

Test suites:

- [ ] `npm run tests` (CJS + ESM). Local runs don't need the CI
      `maxWorkers: 1` quirks, but see CLAUDE.md if workers act up.
- [ ] `src/native_binding_validation.test.ts` specifically: empty/missing
      mountPoint and out-of-range timeoutMs all throw `TypeError`; no
      process abort.
- [ ] `npm run check:memory` (JS memory tests + handle-count monitoring).

Behavioral checks (things unit tests can't cover on CI):

- [ ] **System-volume false positive (the big one):** on a machine with a
      data drive (`D:` etc.), `getVolumeMountPoints()` /
      `getAllVolumeMetadata()` must report `isSystemVolume: false` for data
      drives and `true` only for the Windows drive. Before this fix every
      local NTFS volume was `true`.
- [ ] **Unicode:** set a volume label with non-ANSI characters (e.g.
      `label фото西` on a VHD or USB stick) and confirm
      `getVolumeMetadata()` returns it intact (was ACP mojibake). If
      feasible, also a mounted-folder mount point under a Unicode-named
      directory.
- [ ] **Network drive:** map a share to a drive letter; `remote: true`,
      `mountFrom` = `\\server\share` via `WNetGetConnectionW` (non-ASCII
      share name is a bonus check). Disconnect the server and confirm
      `status` degrades (timeout/disconnected) within `timeoutMs` and that
      other drives in the same enumeration still report `healthy` (the
      ready-future polling fix).
- [ ] **timeoutMs semantics:** `getVolumeMetadata(mp, {timeoutMs: 0})`
      completes (0 = disabled); small timeout against a dead mapped drive
      returns `timeout`/`disconnected` promptly.
- [ ] **Shutdown:** a short script that queries volumes then exits cleanly —
      no hang, no crash on exit (thread-pool shutdown path). >64-core clamp
      is code-review-only unless a big machine is available.
- [ ] **skipNetworkVolumes limitation (documented, verify honest):** with a
      mapped drive, `getAllVolumeMetadata({skipNetworkVolumes: true})` may
      still probe it (mapped drives report the server's filesystem, usually
      NTFS, so fstype matching can't identify them). Confirm behavior and
      that nothing regresses; native drive-status timeouts bound the
      blocking. If this matters in practice, the follow-up is a native
      `GetDriveTypeW == DRIVE_REMOTE` early-return gated on the option.

Optional:

- [ ] clang-tidy on Windows (limited value — see `doc/windows-clang-tidy.md`).
