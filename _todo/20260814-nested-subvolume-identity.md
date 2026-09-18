---
title: Identity for btrfs subvolumes that are not separately mounted
status: todo
created: 2026-08-14
updated: 2026-09-17
---

# TPP: Identity for btrfs subvolumes that are not separately mounted

## Summary

A btrfs subvolume nested inside a mounted filesystem has its own anonymous
`st_dev` but no entry in the mount table, so `getVolumeMetadataForPath()` and
`getMountPointForPath()` throw, and `getVolumeMetadata()` returns neither `uuid`
nor `subvolumeUuid` for it. The identity exists and is readable unprivileged; the
library simply never asks for it.

This completes `_todo/20260704-btrfs-zfs-subvolume-uuid.md`, which delivered
subvolume identity for _mounted_ subvolumes only.

## Current phase

A downstream consumer review on 2026-08-25 confirmed Option A and the
`mountPoint` / `subvolumeRoot` split, and found contract and coverage gaps that
had to close before release. Those are closed, as are three rounds of
cross-model review. The work is committed; only the release remains.

- [x] Reproduce on a loopback btrfs and isolate the cause.
- [x] Confirm `BTRFS_IOC_GET_SUBVOL_INFO` answers for nested subvolumes,
      unprivileged.
- [x] Settle the API shape — `subvolumeRoot`, set whenever it is determinable.
      Decided 2026-08-15; see **Public API** and **Decisions**.
- [x] Write the initial failing tests and implementation.
- [x] Complete the initial docs and CHANGELOG pass.
- [x] Correct the identity/consumer contract and add the missing deterministic
      regressions (see **Release blockers**).
- [x] Re-run the full verification matrix.
- [x] Close the cross-model review findings — three rounds, ten findings, each
      reproduced before it was fixed (see **Validation and review**).
- [ ] Release 2.6.0 ← **you are here**. Run `npm run preflight` first.

## Required reading

- `CLAUDE.md`, `CONTRIBUTING.md`
- `doc/subvolume-identity.md`, `doc/gotchas.md`
- `_todo/20260704-btrfs-zfs-subvolume-uuid.md` — the shipped design this extends
- `src/volume_metadata.ts` — `findMountPointByDeviceId()` (363),
  `_getVolumeMetadata()` (61), `_getVolumeMetadataForPath()` (280)
- `src/mount_point_for_path.ts` — the other caller of `findMountPointByDeviceId()`
- `src/linux/mount_points.ts` — `getLinuxMtabMetadata()`, exact-path only
- `src/linux/mtab.ts` — `parseSubvolInfo()`, `isReadOnlyMount()`
- `src/linux/volume_metadata.cpp` — the ioctl block and its `fstype` gate (174-216)
- `src/common/volume_metadata.h` — `VolumeMetadataOptions`, the native result struct
- `src/linux/btrfs-subvolume.test.ts` — the host-conditional test pattern to follow
- `../photostructure/_p1/20260814-nested-subvolume-no-volsha.md` — the consumer
  contract and why `mountPoint` cannot double as a URI-coordinate root
- [Btrfs subvolume identity](https://btrfs.readthedocs.io/en/latest/Subvolumes.html)
  and [the subvolume-info ioctl](https://btrfs.readthedocs.io/en/latest/btrfs-ioctl.html)
  — especially local `uuid` versus `received_uuid`

## Description

Reproduce with a loopback btrfs (no root needed beyond `mount`):

```bash
ROOT=$(mktemp -d /tmp/fsm-subvol-XXXXXX)
truncate -s 2G "$ROOT/btrfs.img"
mkfs.btrfs -q "$ROOT/btrfs.img"
sudo mount -o loop,user_subvol_rm_allowed "$ROOT/btrfs.img" "$ROOT/mnt"
sudo chown "$USER" "$ROOT/mnt"
btrfs subvolume create "$ROOT/mnt/rw-nested"
btrfs subvolume snapshot -r "$ROOT/mnt/rw-nested" "$ROOT/mnt/ro-snap"
mkdir "$ROOT/mnt/plaindir"
```

Each nested subvolume gets a distinct `st_dev` and **no mount-table entry**:

```
$ROOT/mnt              dev=164     ← the only entry in /proc/self/mountinfo
$ROOT/mnt/plaindir     dev=164
$ROOT/mnt/rw-nested    dev=171
$ROOT/mnt/ro-snap      dev=172
```

Three failures follow.

**`getVolumeMetadataForPath()` throws.** `findMountPointByDeviceId()` compares
`stat().dev` of each candidate against the target. `$ROOT/mnt` is an ancestor but
its device differs, so phase 1 finds nothing; phase 2 finds nothing; it throws
`No mount point found for path`.

**`getMountPointForPath()` throws** for the same reason — it calls the same
resolver (`src/mount_point_for_path.ts:69`).

**`getVolumeMetadata()` on the subvolume path returns almost nothing.** The cause
is the gate at `volume_metadata.cpp:184`, `options_.fstype == "btrfs" &&
is_directory`: `fstype` comes from the mount-table lookup, and a path with no
mount entry has none, so the btrfs branch never runs. `available` still populates
because `statfs()` works on any path.

### Reproduced on this dev box, 2026-08-15

No loopback needed: `/mnt/12tb` (`/dev/sda1`, btrfs, `subvolid=5,subvol=/`) has
four nested subvolumes and two plain directories. Measured with the shipped code:

```
/mnt/12tb                          getVolumeMetadata        uuid=03c98b0e-… subvolumeUuid=b277cad3-… subvolid=5 subvol=/
/mnt/12tb                          getMountPointForPath     "/mnt/12tb"
/mnt/12tb/backup-2026-05-02        getVolumeMetadata        {status, size, used, available, isSystemVolume:false, isReadOnly:false, mountPoint, remote:false}
/mnt/12tb/backup-2026-05-02        getVolumeMetadataForPath THREW: No mount point found for path
/mnt/12tb/backup-2026-05-02        getMountPointForPath     THREW: No mount point found for path
/mnt/12tb/backup-2026-05-02@frozen (read-only snapshot)     same as above — isReadOnly:false is WRONG
/mnt/12tb/migration-2026-07-24     (plain directory)        all three succeed, resolve to /mnt/12tb
```

### Why this matters downstream

PhotoStructure derives a stable per-volume URI authority from `subvolumeUuid`.
With none available it falls back to a path-based URI, which breaks when the
filesystem is mounted elsewhere — observed in a live library: 152 files became
unresolvable after `/media/mrm/12tb` was remounted at `/mnt/12tb`. See
`photostructure/_p1/20260814-nested-subvolume-no-volsha.md`.

## Lore

- **Two btrfs ioctls, only one needs root. Do not conflate them.**
  `btrfs subvolume list` / `show` use `BTRFS_IOC_TREE_SEARCH` and fail
  unprivileged with `Operation not permitted`. `BTRFS_IOC_GET_SUBVOL_INFO` — the
  one this library already uses — is unprivileged since kernel 4.18. An earlier
  analysis of this bug rejected per-subvolume identity outright after seeing the
  CLI fail. That conclusion was wrong and cost a full design round.
- **The current native field is the local subvolume UUID only.** The ioctl code
  exports `subvol_info.uuid` as `subvolumeUuid`; it does not read
  `subvol_info.received_uuid`. A received subvolume gets a fresh local UUID, while
  the source UUID is recorded separately as `received_uuid`. Therefore this
  release provides stable local identity across remount/reboot and direct
  remounting of the same subvolume, but does **not** make source URIs resolve on a
  received copy. Correct every comment and document that implies otherwise.
- `received_uuid` is a possible additive follow-up, not part of this release. If
  it is exposed later, fs-metadata should report the raw nonzero value truthfully;
  the consumer owns alias policy. PhotoStructure must only accept it as an
  authority alias while the received subvolume is read-only, because older
  btrfs-progs could leave `received_uuid` set after making the subvolume writable.
- **`is_directory` in the existing gate is load-bearing** — the ioctl needs a
  directory fd. A subvolume root is always a directory, so this stays satisfied.
- The ioctl returns a **positive** value on success (observed: 1). Only a
  negative return indicates failure. Already noted in the source; easy to get
  wrong when copying the call.
- **CI is unprivileged and typically ext4/overlay**, so no test may require
  `mount`. Follow `src/linux/btrfs-subvolume.test.ts`: btrfs-only assertions
  no-op with a console note on other hosts, and a universal invariant
  ("never on non-btrfs") always runs.
- ZFS needs nothing here. Measured on a loopback pool: every dataset _and_ every
  accessed snapshot is a real mount entry, so all of them already resolve and
  carry distinct identity. This is a btrfs-shaped problem only.

### Measured 2026-08-15 (a throwaway C probe over the ioctl, run as uid 1000)

```
/mnt/12tb                          rc=0 dev=110 ino=256   treeid=5   flags=0x0 name=""                 uuid=b277cad3-…
/mnt/12tb/backup-2026-05-02        rc=1 dev=113 ino=256   treeid=256 flags=0x0 name=backup-2026-05-02  uuid=319fe68e-…
/mnt/12tb/backup-2026-05-02@frozen rc=1 dev=120 ino=256   treeid=257 flags=0x1 name=…@frozen           uuid=d91150a1-… parent_uuid=319fe68e-…
/mnt/12tb/migration-2026-07-24     rc=0 dev=110 ino=9107  treeid=5   flags=0x0 name=""                 uuid=b277cad3-…  ← plain dir, reports its owner
/home, /tmp (ext4)                 ioctl rc=-1 ENOTTY
```

- **`st_ino == 256` identifies a btrfs subvolume root.** `BTRFS_FIRST_FREE_OBJECTID`
  is the root directory inode of every subvolume, including the top-level tree
  (id 5). Plain directories have other inodes. This is the exact stop condition
  for the walk up to the subvolume root — no inference needed.
- **The ioctl's `flags` field uses root-item semantics, not the create-ioctl's.**
  Read-only shows as `0x1` = `BTRFS_ROOT_SUBVOL_RDONLY` `(1ULL << 0)`, declared
  in `<linux/btrfs_tree.h>`. `BTRFS_SUBVOL_RDONLY` `(1ULL << 1)` in
  `<linux/btrfs.h>` is for `BTRFS_IOC_SUBVOL_GETFLAGS`/`SETFLAGS`/`SNAP_CREATE_V2`
  and would silently always test false here. `<linux/btrfs.h>` does **not**
  include `<linux/btrfs_tree.h>`, so define the bit with an `#ifndef` fallback.
  Cross-checked against `btrfs property get -ts <path>` (`ro=true` / `ro=false`),
  which works unprivileged.
- **`statvfs()` does not see a read-only subvolume.** `f_flag` is `0x1000` on
  both the read-only snapshot and its read-write sibling; `ST_RDONLY` is clear on
  both, because read-only-ness is a root-item property, not a mount property.
  The TPP's earlier suggestion to source `isReadOnly` from `ST_RDONLY` does not
  work — the ioctl flag is the only signal.
- **The return value is 0 for the top-level subvolume and 1 for nested ones.**
  `>= 0` (what the code already tests) is correct; `== 0` and `== 1` are both
  wrong.
- The ioctl also returns `treeid` (the subvolume id — the same number the
  `subvolid=` mount option carries), `parent_id`, `dirid`, and `name`. `name` is
  a **basename**, not a path, so it cannot produce a `subvol=`-style value.
- **A test cannot build its own subvolume fixture.** `btrfs-subvolume(8)`:
  deletion needs `CAP_SYS_ADMIN` or the `user_subvol_rm_allowed` mount option.
  `/mnt/12tb` has neither, so a created subvolume could not be cleaned up.
  Host-conditional tests therefore stay read-only over whatever the host has,
  and CI coverage comes from injected `stat`/`statfs` fakes instead.
- `BTRFS_SUPER_MAGIC` is `0x9123683e`, and Node's `fs.statfs()` exposes it as
  `type` — no native call needed to confirm a path is on btrfs.
- This dev box is a usable test bed: `/mnt/12tb` has read-write nested
  subvolumes, a read-only snapshot (`…@frozen`), and plain directories.

## Public API

One additive field, plus two provenance/behavior changes. `mountPoint` keeps its
current meaning: "what `findmnt` would say".

- **`VolumeMetadata.subvolumeRoot?: string`** — the absolute path where the
  subvolume identified by `subvolumeUuid` begins, e.g.
  `/mnt/12tb/backup-2026-05-02`. Set whenever it is determinable on btrfs,
  **including when it equals `mountPoint`**.
- **`VolumeMetadata.subvolid`** (already declared on `MountPoint`) gains a second
  source: the ioctl's `treeid`, used when the path's subvolume is not the mount's
  subvolume. The two agree wherever both exist.
- **`isReadOnly`** becomes `mountIsReadOnly || subvolumeIsReadOnly`. A read-only
  subvolume under a read-write mount now reports `true`.
- `subvol` stays defined only from the `subvol=` mount option, so it is
  `undefined` for a nested subvolume. There is no mount option to read, and
  deriving one would break its documented "verbatim" contract.

### Consumer contract

Keep topology and identity coordinates separate throughout the API and docs:

- `mountPoint` is always an actual kernel mount — the path `findmnt` would
  report. A nested subvolume root is not a mount point and must never be returned
  or documented as one.
- `subvolumeRoot` is the reachable path where the identity described by
  `subvolumeUuid` begins. It is a coordinate root, not topology. It is populated
  for ordinary btrfs mounts too (`subvolumeRoot === mountPoint`) so callers can
  use one formula.
- `getVolumeMetadataForPath(path)` and `getVolumeMetadata(path)` are the
  identity-aware entry points for an arbitrary path. `getMountPointForPath(path)`
  answers topology only. Re-querying
  `getVolumeMetadata(await getMountPointForPath(path))` intentionally returns the
  containing mount's subvolume identity and loses nested identity.
- A cross-platform consumer may derive its own
  `uriRoot = subvolumeRoot ?? mountPoint`, but must preserve both fields and must
  key URI-coordinate caches as URI roots, not as mount points. fs-metadata does
  not add a consumer-specific `uriRoot` field.
- For a bind mount of a subdirectory of a btrfs subvolume,
  `subvolumeUuid` remains correct but `subvolumeRoot` is `undefined`: the root is
  not reachable in that mount namespace. A consumer cannot form a stable
  subvolume-relative coordinate from the current API and must either decline
  stable-URI generation or wait for a future mountinfo/root-offset API.

### Identity scope

`subvolumeUuid` is `subvol_info.uuid`, the local UUID. It is stable across
remount/reboot and remains the same when the same subvolume is mounted at a
different path. It is **not** send/receive-portable: the received copy has a new
local UUID, and the source UUID lives in `received_uuid`, which 2.6.0 does not
export. Do not add `receivedSubvolumeUuid` in this TPP; that requires a separate
consumer-alias design and tests for writable legacy received copies.

### Decisions (2026-08-15)

1. **`subvolumeRoot` is set even when it equals `mountPoint`**, reversing this
   plan's earlier "only when it differs". The consumer's operation is
   `relative(subvolumeRoot, file)` to build a URI under the `subvolumeUuid`
   authority; that formula needs the field in both cases, and
   `subvolumeRoot ?? mountPoint` at every call site is a trap. The field is new
   and optional, so nothing breaks either way.
2. **`subvolumeRoot` is left `undefined` when the subvolume root is not reachable
   under the mount** — the case is `mount --bind /mnt/12tb/backup/x /mnt/y`,
   where `/mnt/y` is a mount point but not a subvolume root (`st_ino != 256`).
   `subvolumeUuid` is still correct there, so the two fields are independent.
3. **`getVolumeMetadata()` on a nested subvolume path now reports the containing
   mount as `mountPoint`** instead of echoing the input path. Today's echo
   asserts a mount the kernel does not have — the exact thing Option B was
   rejected for. `subvolumeRoot` carries the queried subvolume's own path, so no
   information is lost. This is a visible behavior change for non-mount-point
   inputs on Linux btrfs, and belongs in the CHANGELOG.
4. **The fallbacks are gated on btrfs, not generic.** A generic "longest ancestor
   mount" fallback would also be defensible from mount-table semantics, but it
   turns today's loud `No mount point found for path` into a plausible wrong
   answer for every other anomaly (notably a caller-supplied `mountPoints` array
   that omits the real mount). Gating keeps the error honest for a complete mount
   list. A caller-supplied, incomplete `mountPoints` list can still omit a deeper
   real btrfs mount and make phase 3 select a shallower btrfs ancestor; this is an
   existing precondition of the cache option and must be stated explicitly in
   `Options.mountPoints` TSDoc and `doc/gotchas.md`.

## Solutions

### Option A (chosen): resolve the containing mount, then the subvolume

Four changes, all Linux-only. The shared rule, used in both resolvers:

> A path whose `st_dev` matches no entry in a complete mount-point view, whose
> longest ancestor mount is `fstype: "btrfs"`, and whose `statfs().type` is
> `BTRFS_SUPER_MAGIC` (`0x9123683e`) is inside a nested subvolume of that mount.

1. **`findMountPointByDeviceId()` (`src/volume_metadata.ts:363`) gains phase 3.**
   When phases 1 and 2 find nothing, apply the rule above and return the longest
   ancestor mount. With a complete mount-point view, every other anomaly still
   throws exactly as today. This alone fixes `getMountPointForPath()`. Callers
   need to know phase 3 fired (see 3), so the internal form returns
   `{ mountPoint, nested: boolean }` with a thin wrapper preserving the exported
   string-returning signature.

2. **Find the subvolume root.** `findSubvolumeRoot(path, mountPoint)`: walk up
   from `path` (or its `dirname()` if it is not a directory), bounded at
   `mountPoint` inclusive, and stop at the first directory with `st_ino === 256`
   and unchanged `st_dev`. Return `undefined` if the walk reaches `mountPoint`
   without that (bind-mounted subdirectory) or if `dirname(path)` is not at or
   below `mountPoint` (file bind mount). Bounded by path depth; only walks
   directories that are ancestors of an already-resolved path.

3. **Give the native worker the subvolume root to probe.** `_getVolumeMetadata()`
   resolves the mount entry by exact path, else — under the rule above — by
   longest ancestor. It then passes `mountPoint: subvolumeRoot ?? <queried path>`
   to the native call (native keeps probing exactly one path, unchanged) while
   the _result_ reports the mount entry's path as `mountPoint`. Probing the
   subvolume root rather than the queried path also makes the ioctl work when the
   caller passed a file. `_getVolumeMetadataForPath()` passes the queried
   directory instead of the resolved mount only when phase 3 fired.

4. **Native: report the two things only the ioctl knows.** In the existing
   `BTRFS_IOC_GET_SUBVOL_INFO` block in `src/linux/volume_metadata.cpp`, also set
   `subvolid` from `treeid` and `isReadOnly = true` when
   `flags & BTRFS_ROOT_SUBVOL_RDONLY`. TypeScript then ORs `isReadOnly` with the
   mount's value, and drops the mount-derived `subvol`/`subvolid` when the
   queried subvolume is not the mount's.

Consumers get a distinct, stable **local** identity per nested subvolume,
consistent with the model shipped for mounted subvolumes. Send/receive lineage
is out of scope; see **Identity scope**.

### Option B (rejected): treat the subvolume root as a mount point

Returning the subvolume root from `getMountPointForPath()` would need no new
field, but it makes the library assert mounts that `/proc/self/mountinfo` does
not list, and silently changes `mountPoint` for every existing consumer.

### Option C (rejected): let consumers inherit the containing mount's identity

Considered and withdrawn downstream. It makes a file's identity depend on how
the filesystem happens to be mounted: mounting the same subvolume directly later
would change the authority even though its local subvolume UUID did not. It also
collapses distinct nested subvolumes into their containing mount's identity.

### Rejected variants of Option A

- **Generic ancestor fallback** (not btrfs-gated): see Decision 4.
- **`statfs().f_flag & ST_RDONLY` for `isReadOnly`**: measured to be clear on a
  read-only subvolume. Only the ioctl flag works.
- **Walking up on `st_dev` change alone**, without the `st_ino === 256` test:
  cannot distinguish "reached the subvolume root" from "reached a bind-mounted
  subdirectory", and would report a wrong `subvolumeRoot` for the latter.
- **A second native option for the ioctl path** (probe `mountPoint`, run the
  ioctl on `subvolumeRoot`): needs a second `open()` and a second
  `ValidatePathForRead()` in the worker. Probing one path — the subvolume root —
  gives the same numbers, since `statvfs` is per-filesystem and blkid keys on the
  device string.

## Tasks

- [x] **Settle the API shape.** Done 2026-08-15 — see **Public API** / **Decisions**.
- [x] Unit tests with injected `stat`/`statfs` — `src/linux/nested-subvolume.test.ts`
      (these are the CI coverage; a runner with no btrfs still exercises them):
  - `findMountPointByDeviceId()` phase 3 returns the btrfs ancestor for a target
    whose device matches no entry.
  - Phase 3 does **not** fire when the ancestor is not btrfs, or when
    `statfs().type` is not `BTRFS_SUPER_MAGIC` — the existing
    `No mount point found for path` still throws.
  - `findSubvolumeRoot()`: nested subvolume; path inside a nested subvolume;
    plain directory under the mount; bind-mounted subdirectory (`undefined`);
    file bind mount (`undefined`).
  - Follow the injection pattern already used by `src/skip_network_volumes.test.ts`
    and `src/dead_mount_isolation.test.ts`; `statfsImpl` needs the same treatment
    `statImpl`/`canReaddirImpl` already get.
- [x] Host-conditional integration tests in `src/linux/btrfs-subvolume.test.ts`.
      Discovery is read-only: an immediate child directory with `st_ino === 256`
      on a device other than the mount's. Verified on this box that it finds 5
      nested subvolumes under `/mnt/12tb`, so the assertions really run here.
- [x] Universal invariant that runs everywhere: `subvolumeRoot` is undefined off
      btrfs — in `src/volume_metadata.test.ts` (`getAllVolumeMetadata()`).
- [x] Implement changes 1-4.
- [x] Verify on this box against `/mnt/12tb`: nested subvolumes get distinct
      `subvolumeUuid` (`319fe68e-…`, `d91150a1-…`) and `subvolid` (256, 257),
      `…@frozen` reports `isReadOnly: true`, `subvolumeRoot` is the directory
      queried, and `mountPoint` is `/mnt/12tb`. A plain directory and a file
      under the mount keep `subvolid: 5` / `subvol: "/"` with
      `subvolumeRoot: "/mnt/12tb"`.
- [x] `npm test` (691 passed, 78 skipped), `npm run test:esm` (same),
      `npm run node-gyp-rebuild`, `npx tsc --noEmit`, eslint, prettier,
      `npm run lint:native` (clang-tidy, no issues).
- [x] Docs: `doc/subvolume-identity.md`, `doc/gotchas.md`, `CONTRIBUTING.md`,
      `CLAUDE.md`, and the `VolumeMetadata` / `MountPoint` TSDoc.
- [x] CHANGELOG entry for 2.6.0, including the `mountPoint` behavior change
      (Decision 3).

## Release blockers

All closed 2026-09-17. `npm run preflight` still has to run at release time.

- [x] **Correct the send/receive contract everywhere.** Update
      `src/linux/volume_metadata.cpp`, `src/types/volume_metadata.ts`,
      `doc/subvolume-identity.md`, this TPP, and any current-release CHANGELOG
      wording so `subvolumeUuid` is described as the local `uuid`. Historical
      notes may say btrfs records the source as `received_uuid`, but must not say
      this package exports or resolves through it. Do not add the field in 2.6.0.
- [x] **Pin innermost-wins.** Extend `src/linux/nested-subvolume.test.ts` with a
      subvolume nested inside another nested subvolume and assert
      `findSubvolumeRoot()` returns the innermost `st_ino === 256` ancestor for
      both a directory and a file below it.
- [x] **Add deterministic entry-point coverage, not only helper coverage.** With
      injected `stat`/`statfs`, a fixture mount table, and a fake native result,
      prove `getVolumeMetadataForPath()` keeps querying the nested path, returns
      the containing kernel `mountPoint`, and returns the nested
      `subvolumeRoot`/`subvolumeUuid`. Also prove that querying the returned
      `mountPoint` reports the containing mount's identity instead. The
      host-conditional integration test remains valuable but may skip in CI.
- [x] **Test `getContainingMountEntry()` from a fixture mount table.** Cover
      deepest-ancestor selection and last-entry-wins for stacked entries. This
      protects the direct `getVolumeMetadata(nestedPath)` route independently of
      `resolveMountPoint()`.
- [x] **State the cached-mount-list precondition.** Extend `Options.mountPoints`
      TSDoc and `doc/gotchas.md`: on Linux the list must include every reachable
      mount ancestor (and exact file-mount targets where applicable), normally by
      using `getVolumeMountPoints({ includeSystemVolumes: true })`; otherwise a
      deeper btrfs mount omitted by the caller can be mistaken for a nested
      subvolume of a shallower btrfs ancestor.
- [x] **Keep the bind-subdirectory result explicit.** Add/retain a regression
      showing a bind-mounted subvolume subdirectory returns the correct local
      `subvolumeUuid` with `subvolumeRoot: undefined`, and document that no stable
      subvolume-relative coordinate can be formed from that result. Do not invent
      a root or overload `mountPoint`.
- [x] Re-run `npm test`, `npm run test:esm`, `npm run node-gyp-rebuild`,
      `npx tsc --noEmit`, ESLint, Prettier, `npm run lint:native`, and
      `npm run check:exports`. Then run `npm run preflight` before release as
      required by `CLAUDE.md`.

## Remaining

- [ ] Complete every **Release blocker** above.
- [ ] **Review the diff** — nothing is committed yet. Recheck
      `_getVolumeMetadata()`'s exact-then-containing mount lookup, the extra
      `statfs()` on the miss path, and the public distinction between topology
      (`mountPoint`) and identity coordinates (`subvolumeRoot`).
- [ ] Release 2.6.0, then notify PhotoStructure to bump the pin in all four of
      its `src/*/package.json`.

## Implementation notes (2026-08-15)

- New `src/linux/subvolume.ts`: `BtrfsSuperMagic`, `BtrfsSubvolumeRootInode`,
  `isBtrfsPath()`, `findSubvolumeRoot()`.
- New `src/fs.ts` `statfsAsync()` wrapper, injectable like `statAsync`.
- `findMountPointByDeviceId()` keeps its signature (plus an optional
  `statfsImpl`) and now delegates to `resolveMountPoint()`, which returns
  `{ mountPoint, nested }`. Only `_getVolumeMetadataForPath()` needs `nested`.
- New `getContainingMountEntry()` in `src/linux/mount_points.ts` — the longest
  ancestor mount entry, used only when the exact-path lookup misses.
- `_getVolumeMetadata()` hands the native worker `subvolumeRoot` as its
  `mountPoint` when one was found, and reports the mount entry's path as the
  result's `mountPoint`. `isReadOnly` is now the OR of the mount's and the
  subvolume's.
- Native (`src/linux/volume_metadata.cpp`): the existing ioctl block also sets
  `subvolid` from `treeid` and `isReadOnly` from `BTRFS_ROOT_SUBVOL_RDONLY`;
  `src/common/volume_metadata.h` carries `double subvolid` (omitted when 0).

## Out of scope and settled questions

- ~~**Can the test create its own fixture unprivileged?**~~ Answered 2026-08-15:
  creation needs only a writable parent, but **deletion** needs `CAP_SYS_ADMIN`
  or the `user_subvol_rm_allowed` mount option (`btrfs-subvolume(8)`), which an
  arbitrary host btrfs will not have. Tests stay read-only over host layout; CI
  coverage comes from injected `stat`/`statfs`.
- **Nested enumeration does not ship in 2.6.0.**
  `BTRFS_IOC_GET_SUBVOL_ROOTREF` / `INO_LOOKUP_USER` could let
  `getVolumeMountPoints()` enumerate nested subvolumes, but resolution-on-demand
  is sufficient for this consumer. Add enumeration only for a concrete listing
  requirement.
- **Received-UUID aliases do not ship in 2.6.0.** See **Identity scope**.
- **Bind-root offsets do not ship in 2.6.0.** A future mountinfo-based API may
  expose enough information to recover a bind-mounted subdirectory's
  subvolume-relative prefix. Until then, `subvolumeRoot` stays `undefined`.
- **Coordinate with `_todo/20260811-mountinfo-topmost-mount.md`.** That plan may
  replace mount-table reading with `/proc/self/mountinfo`. Phase 3 only needs the
  deepest containing mount, which both sources answer; confirm its changes do not
  invalidate `getContainingMountEntry()` or duplicate work before either plan
  lands.
