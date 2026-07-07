# TPP: macOS validation of security-review fixes

**Status:** Baseline validation DONE (2026-07-05). Deeper behavioral
validation of the new probe machinery remains.

**Machine:** `ssh MAC_BOX`, repo at `~/src/fs-metadata`. node/npm live in
`/usr/local/bin`, which is NOT on the non-interactive ssh PATH — prefix
commands with `export PATH=/usr/local/bin:$PATH`. Node v24.15.0.

**Tree state caveat:** MAC_BOX currently holds an rsync of the Linux working tree
(all fixes, uncommitted) — including a stray copy of
`_todo/20260704-btrfs-zfs-subvolume-uuid.md`. Once the commit plan in
`_done/20260705-security-review-commit-plan.md` lands and pushes, run
`git fetch && git reset --hard origin/main && git clean -n` (review before
`-f`) on MAC_BOX to de-drift.

## What changed on macOS (see CHANGELOG 2.1.0 § Fixed)

- `src/darwin/volume_mount_points.cpp` — accessibility probes rewritten:
  promise + detached thread (no blocking future destructors), per-path
  in-flight dedup in `g_inflightProbes` (max one native thread per distinct
  hung mount path, self-erasing, exception-safe insert), single
  `wait_until(deadline)` budget for the whole probing phase, `timeoutMs 0`
  = no timeout.
- `src/darwin/volume_metadata.cpp` — entry point throws `TypeError` for
  missing/invalid options instead of relying on downstream failure.
- Shared TS changes (skipNetworkVolumes, timeout validation) apply on macOS
  too; `getAllVolumeMetadata({skipNetworkVolumes: true})` skips remote
  fstypes (`smbfs`, `nfs`, …) using enumeration fstype.

## Already validated (2026-07-05)

- [x] Native compiles clean (`npx node-gyp rebuild`)
- [x] `npm run tests` — 522 passed × CJS and ESM, 0 failures
- [x] `native_binding_validation.test.ts` passes on Darwin (TypeErrors, no
      abort; timeout bounds enforced)

## Remaining tasks

- [ ] `npm run check:memory` on macOS. Per CLAUDE.md, ASAN may fail due to
      SIP — that is expected/acceptable; record what happens.
- [ ] **Dead-mount probe behavior** (the heart of the darwin fix). Set up a
      mount that hangs: e.g. mount an SMB/NFS share from a VM or second
      machine, then kill the server or block it
      (`sudo pfctl` rule, or just pull the VM's network). Then:
  - [ ] `getVolumeMountPoints({timeoutMs: 3000})` returns within ~3s total
        (not 3s × number of dead mounts) with the dead mount
        `status: "disconnected"` / `error: "Access check timed out"`.
  - [ ] Healthy volumes in the same call still report `healthy` even when
        the dead mount ate the budget (expired-deadline poll path).
  - [ ] **Thread-leak bound:** call `getVolumeMountPoints()` in a loop
        (say 20×); thread count of the node process must stay flat, not grow
        by one per call (`ps -M <pid> | wc -l` before/during/after). This
        verifies the per-path probe dedup.
  - [ ] After the share recovers, a later call reports it healthy again
        (probe map self-cleans).
- [ ] `getVolumeMountPoints({timeoutMs: 0})` on a healthy system — completes
      (0 = disabled, must not mean instant timeout).
- [ ] `getAllVolumeMetadata({skipNetworkVolumes: true})` with a mounted
      (healthy) SMB share: share appears with shallow metadata and
      `remote: true`, without a native metadata query for it.
- [ ] Spot-check unchanged behavior: `volumeRole` / system-volume
      classification (`filesystem.test.ts`, `version-compat.test.ts` already
      pass — a manual `getVolumeMountPoints()` eyeball on a real Mac with
      external volumes is still worthwhile).
- [ ] Optional: `leaks --atExit -- node <script>` over a repeated
      getVolumeMountPoints loop for native leak confirmation (Instruments-
      free).
