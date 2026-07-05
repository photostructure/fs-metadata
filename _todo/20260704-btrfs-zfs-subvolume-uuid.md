---
title: Subvolume UUIDs for btrfs/zfs (disambiguate volumes that share a filesystem UUID)
status: todo
created: 2026-07-04
spans: fs-metadata (this repo) + photostructure (consumer)
---

# TPP: Subvolume UUIDs for btrfs / zfs

## Summary

On btrfs (and other file systems, web search and validate and gather a list for our docs), several **mount points** can be distinct subvolumes/datasets of
**one filesystem**. `libblkid` keys UUID on the block device, so fs-metadata
reports the _same_ `uuid` for all of them. PhotoStructure derives its volume
identity (`volsha = shortStringSha(uuid)`) from that UUID, so sibling subvolumes
**collide on one volsha** — which made `psfile://` URIs resolve to the wrong
sibling volume. PhotoStructure just added a resolution-time backstop (union of
all live mounts + `exists()`-pick), but the clean fix is to give fs-metadata a
way to distinguish subvolumes and expose a per-subvolume identifier **additively**
(never replacing `uuid`). This TPP covers the fs-metadata feature plus the phased
PhotoStructure integration.

## Current phase

- [x] Research & Planning (this document)
- [x] Write and validate breaking tests (fs-metadata: btrfs mtab fixtures in
      `mtab.test.ts` + native `btrfs-subvolume.test.ts`; validated red→green on a live btrfs host)
- [x] Design review of the additive API shape (field names + header/gating strategy settled — see Lore)
- [x] Implementation — fs-metadata Phase 1 (mount-option tier) — **done, verified live**
- [x] Implementation — fs-metadata Phase 2 (btrfs ioctl tier) — **done, verified live**
- [ ] Implementation — PhotoStructure Phase 3 (consume in fallback path) — deferred to the PhotoStructure repo
- [~] zfs (Phase 4) — **IN PROGRESS: evaluation** (does zfs collide? cheap-guid feasibility)
- [ ] URI-carried identity (Phase 5) — deferred, scope only if needed
- [ ] Review & final integration verification (fs-metadata `npm run all`; then Phase 3)

## Session log (2026-07-04)

fs-metadata Phases 1 & 2 landed and verified on a live btrfs host (`/`=@ /
`/home`=@home, one device). Result through the real library:

```
/      { uuid: 9486d442-…, subvolumeUuid: 9ad5ad15-…, subvol: /@,     subvolid: 256 }
/home  { uuid: 9486d442-…, subvolumeUuid: 3508cb72-…, subvol: /@home, subvolid: 257 }
→ fs uuid collides: true ; subvolumeUuid distinct: true
```

Files changed (all in fs-metadata):

- `src/types/mount_point.ts` — added `subvol?: string`, `subvolid?: number`.
- `src/types/volume_metadata.ts` — added `subvolumeUuid?: string`.
- `src/types/native_bindings.ts` — added `fstype?` to `GetVolumeMetadataOptions`.
- `src/linux/mtab.ts` — `parseSubvolInfo()`; wired into `mountEntryToMountPoint`
  AND `mountEntryToPartialVolumeMetadata` (both entry points carry the fields).
- `src/volume_metadata.ts` — threads `o.fstype` (from mtab) to native.
- `src/common/volume_metadata.h` — `fstype` in options (+FromObject); `subvolumeUuid`
  in the metadata struct (+ToObject, emitted only when non-empty like `volumeRole`).
- `src/linux/volume_metadata.cpp` — `__has_include(<linux/btrfs.h>)`-guarded
  `BTRFS_IOC_GET_SUBVOL_INFO` on the reused mount-point fd; canonical UUID format.
- `src/linux/mtab.test.ts` + new `src/linux/btrfs-subvolume.test.ts` — coverage.
- `.github/workflows/build.yml` — added `linux-headers` to the Alpine prebuild apk.
- Docs: new `doc/subvolume-identity.md`; pointers in `CLAUDE.md`, `doc/gotchas.md`.

Verification run: `tsc --noEmit` OK, `eslint` OK, `clang-tidy` OK (both native
files), `node-gyp rebuild` clean (no warnings), full CJS suite = 493 passed / 76
skipped, `build:dist` clean (new fields in public `.d.ts`).

**Review fixes (intern pass):**

- [P1] `btrfs-subvolume.test.ts` originally asserted _global_ uniqueness of
  `subvolumeUuid` across all btrfs mounts — wrong: one subvolume can be mounted at
  many paths (bind mounts, container storage drivers) and correctly returns the
  same uuid. Replaced with a `(fs uuid, subvolid)`-consistency invariant: same
  subvolid → same subvolumeUuid; different subvolid under one fs uuid → different
  subvolumeUuid. Verified the old assertion failed and the new one holds on a
  synthetic 6-mount/2-subvolume host.
- [P2] `parseSubvolInfo` now gates on `fstype === "btrfs"` (was inspecting only the
  option names), so a non-btrfs mount carrying a stray `subvol=` option no longer
  leaks the btrfs-only fields — matches the public-type contract. Added an mtab
  regression test.

Still TODO before commit: full `npm run all` (prettier/full ESM jest) if desired.

## Required reading

**fs-metadata (this repo):**

- `CLAUDE.md` — build/test conventions (jest 30, Node 22/24/26; native N-API build).
- `doc/system-volume-detection.md` — precedent for surfacing a platform-specific
  discriminator (`volumeRole`) additively; mirror that discipline.
- `src/linux/mtab.ts` — `parseMtab()` / `mountEntryToPartialVolumeMetadata()`; the
  mount-option tier plugs in here.
- `src/linux/volume_metadata.cpp` — where libblkid sets `uuid`; the btrfs ioctl
  tier plugs in here.
- `src/types/volume_metadata.ts`, `src/types/mount_point.ts` — public types to extend.

**PhotoStructure (consumer, `~/src/photostructure`):**

- `src/core/uri/volsha.ts` — `volsha = memoize(uuid => shortStringSha(uuid))`.
- `src/core/volumes/VolumeUUID.ts` — `addVolumeUUID` / `readVolumeUUID` identity
  precedence; **this is the integration point** for Phase 3.
- `src/core/uri/psfile.ts` — `psfileToNativePath_()` resolution (union + `exists()`).
- `src/core/fs/FsMetadata.ts` — `volshaToMountPoints()` (the landed backstop) + its spec.
- Memory: `project_nonunique_volsha_resolution.md`.

## Description

Confirmed on a btrfs box (`/` and `/home` are subvolumes `@` / `@home` of one fs):

```
findmnt:  /      /dev/nvme0n1p2[/@]      btrfs  UUID 9486d442-…
          /home  /dev/nvme0n1p2[/@home] btrfs  UUID 9486d442-…

fs-metadata getVolumeMetadata:
  /      { uuid: 9486d442-…, mountFrom: /dev/nvme0n1p2, isSystemVolume: false }
  /home  { uuid: 9486d442-…, mountFrom: /dev/nvme0n1p2, isSystemVolume: false }
```

`mountFrom` is the bare device — the `[/@home]` subvol suffix `findmnt` shows is
**not** in `/proc/self/mounts`' device field; it lives in the **options** field:

```
/proc/self/mounts:
  /dev/nvme0n1p2 /     btrfs rw,…,subvolid=256,subvol=/@
  /dev/nvme0n1p2 /home btrfs rw,…,subvolid=257,subvol=/@home
```

So the discriminator is already in data fs-metadata reads (`parseMtab` → `fs_mntops`),
plus a stronger one is one ioctl away.

## Tribal knowledge

- **libblkid keys on the device, not the mount.** `blkid_get_tag_value(cache, "UUID",
device)` (`volume_metadata.cpp:139`) returns the filesystem UUID; all subvolumes of
  one fs share it. This is the root cause, and it is correct behavior for blkid.
- **Identifier stability (btrfs), strongest last:**
  - `subvolid` (256, 257…) — sequential, stable across remount/reboot on that fs,
    but **not** unique across filesystems and **not** preserved by `btrfs send/receive`.
  - `subvol` path (`/@home`) — human-meaningful; **breaks on rename/move**.
  - subvolume **UUID** (16 bytes, from the root item via `BTRFS_IOC_GET_SUBVOL_INFO`,
    kernel ≥4.18, **unprivileged**) — stable across remount/reboot; `send/receive`
    keeps the source as `received_uuid`; snapshots get a fresh uuid + `parent_uuid`.
    This is the one to prefer for identity.
- **zfs is different and probably doesn't collide the same way:** its `mountFrom` is
  the dataset name (`tank/home`), already per-dataset. The strong id is the dataset
  `guid` (via libzfs `zfs_prop_get`, or `zfs get -Hp -o value guid <mp>`). No cheap
  unprivileged ioctl like btrfs → heavier lift → Phase 4.
- **PhotoStructure identity precedence** (`readVolumeUUID`): a written `.uuid` file
  (`writeVolumeUuidFiles` default **true**) wins over the hardware UUID; `/` is
  hardcoded to the hardware UUID and never writes `.uuid`; `volumeUuidNotExpected`
  also short-circuits system volumes / docker `/`. **The collision only bites the
  hardware-UUID fallback path** — mounts that already have a `.uuid` are unaffected.
- **Migration hazard:** `volsha` is embedded in every stored `psfile://` URI. Changing
  what feeds `shortStringSha` invalidates stored URIs. Keep `.uuid` primacy so only
  _fallback-path_ mounts change — and for those, the current volsha is already the
  ambiguous/buggy one, so it's correcting broken identity, not breaking good identity.
- **Why exposing subvol UUID does not retroactively fix stored psfiles:** the URI
  encodes only `<volsha>` + a mount-relative path; it never recorded the subvolume.
  Subvol UUID only helps _future_ identity (Phase 3) or a _new URI form_ (Phase 5).
- **The one case the `exists()` backstop genuinely can't get right:** btrfs snapshots.
  If `/home` and a snapshot both expose the same relative path, `exists()` matches both
  and tie-breaks by shortest path — can pick the wrong subvolume. Subvolume-aware
  identity is the only real fix; call this out as the correctness argument.

### Validated empirically (2026-07-04, live btrfs box, kernel 6.17, non-root)

- **`BTRFS_IOC_GET_SUBVOL_INFO` is unprivileged — confirmed as euid 1000.** But
  `btrfs subvolume show <mp>` FAILS unprivileged ("Could not search B-tree:
  Operation not permitted") because it uses the privileged `TREE_SEARCH` ioctl.
  Do **not** shell out to `btrfs`; the `GET_SUBVOL_INFO` ioctl is the right path.
- **The ioctl returns a POSITIVE value on success (observed `1`), not `0`.**
  `errno` is 0 and the struct is fully populated. So the C++ success check MUST be
  `ret < 0 → failure` (a `ret != 0` check would wrongly discard good data). Verified
  via `strace`: `ioctl(...BTRFS_IOC_GET_SUBVOL_INFO...) = 1`.
- **`<linux/btrfs.h>` is NOT guaranteed present.** glibc/Debian gets it from
  `linux-libc-dev` (a `build-essential` dep). Alpine's build image installs only
  `util-linux-dev`, so the header is **absent** there → a bare include would break
  the musl prebuild. Fix: `__has_include` guard (compiles either way; feature off if
  absent) **plus** add `linux-headers` to the Alpine prebuild apk so shipped
  prebuilds have it.
- struct `btrfs_ioctl_get_subvol_info_args` is 504 bytes; `uuid` is `__u8[16]`;
  `parent_uuid`/`received_uuid` are all-zero for plain (non-snapshot, non-received)
  subvolumes — matches the send/receive/snapshot semantics documented above.

### Design decisions (settled this session)

- **Field names:** `subvol`/`subvolid` mirror the literal btrfs mount-option tokens
  (btrfs-only by construction); `subvolumeUuid` is deliberately generic so a future
  zfs impl can populate the same field from the dataset `guid`. Documented a full
  **cross-platform** filesystem survey in `doc/subvolume-identity.md` — **only btrfs
  exhibits the block-device-UUID collision**:
  - Linux: zfs `mountFrom` is the dataset name (already distinct); bcachefs subvols
    are subdirs of one mount; nilfs2 `cp=` is point-in-time; Stratis snapshots each
    get their own UUID; CephFS subvols are network dirs.
  - macOS: APFS volumes share a container's space (btrfs-like) but **each has its own
    volume UUID** → no collision; sealed `/` snapshot handled by system-volume-detection.
  - Windows: ReFS block-cloning / Storage Spaces have no subvolume namespace; each
    volume has its own GUID.
  - **Distinct hazard (not fixed here):** LVM/dm snapshots duplicate the origin's fs
    UUID across _two devices_ (blkid "duplicate UUID"); fix is `nouuid`/`xfs_admin -U`.
- **Gating:** thread `fstype` (from mtab) into native `VolumeMetadataOptions` and only
  attempt the ioctl when `fstype == "btrfs"` — avoids speculative btrfs ioctls on
  other filesystems (notably network mounts).
- **fd reuse:** the ioctl runs on the mount-point fd already opened for `fstatvfs`
  (RAII `FdGuard`) — no extra `open()`.
- **UUID format:** raw 16 bytes rendered as canonical lowercase hyphenated UUID
  (matches the existing `uuid` field's presentation).

## Solutions

### Option A (preferred): additive `subvolumeUuid` + fallback-path consumption

**fs-metadata** — extend `MountPoint`/`VolumeMetadata` with optional, additive fields
(undefined off-btrfs/zfs; no consumer breaks). Two tiers:

1. **Mount-option tier (cheap, no new syscalls):** parse `subvol=` / `subvolid=` from
   `fs_mntops` in `mtab.ts`. Surface as `subvol` (path) and `subvolid` (number). Gives
   `(uuid, subvolid)` — enough to _distinguish_ siblings locally today.
2. **Ioctl tier (robust):** in `volume_metadata.cpp`, when `fstype === "btrfs"`, open the
   mountpoint and call `BTRFS_IOC_GET_SUBVOL_INFO`; set `subvolumeUuid` from `args.uuid`.
   Unprivileged; degrade to undefined on `ENOTTY`/`EPERM`/old kernel.

**PhotoStructure** — in `readVolumeUUID`, when falling back to the hardware UUID (no
`.uuid` file), prefer `subvolumeUuid ?? uuid`. Keeps `.uuid` primacy (no migration for
`.uuid` mounts), kills the `/`-vs-`/home` collision at the source for new/rescanned
libraries, and leaves the landed `union + exists()` backstop for legacy rows, zfs, and
bind-mount cases. Do **not** change the primary volsha derivation wholesale.

Pros: additive/reversible in fs-metadata; smallest migration blast radius; solves the
common case at the source. Cons: legacy stored psfiles on fallback mounts still rely on
the `exists()` backstop (incl. the snapshot ambiguity) until re-scanned.

### Option B (deferred): URI-carried subvolume identity (Phase 5)

Record `subvolumeUuid` as a _second, optional_ identifier that new psfiles carry
alongside the volsha; resolve new rows by exact subvol match, fall back to
`union + exists()` for legacy. Closes the snapshot ambiguity for new libraries with no
forced migration, but is a backward-compatible URI/schema extension — more surface.
Only pursue if a feature needs exact per-subvolume identity for legacy rows.

### Non-goal

Replacing `uuid` or the primary `volsha` derivation, or shelling out per-filesystem in
the hot path. `subvolumeUuid` is additive; `uuid` stays the fs UUID.

## Tasks

### Phase 1 — fs-metadata: mount-option tier ✅ (2026-07-04)

- [x] Add optional `subvol?: string` and `subvolid?: number` to `MountPoint`
      (`src/types/mount_point.ts`), documented as btrfs-only.
- [x] Parse them via `parseSubvolInfo()` in `src/linux/mtab.ts`; wired into **both**
      `mountEntryToPartialVolumeMetadata` and `mountEntryToMountPoint` (so both
      `getVolumeMetadata()` and `getVolumeMountPoints()` carry the fields). Added
      btrfs cases to `src/linux/mtab.test.ts` using real `/proc/self/mounts` lines.
- [x] Verify: `npx jest src/linux/mtab.test.ts` (13 pass); live check confirmed `/`
      and `/home` return distinct `subvol`/`subvolid`.

### Phase 2 — fs-metadata: btrfs ioctl tier ✅ (2026-07-04)

- [x] Add optional `subvolumeUuid?: string` to `VolumeMetadata` (`src/types/volume_metadata.ts`),
      documented (stable id; not the fs `uuid`; send/receive & snapshot semantics).
- [x] In `src/linux/volume_metadata.cpp`, for `fstype === "btrfs"` (threaded via
      options) call `BTRFS_IOC_GET_SUBVOL_INFO` on the **reused** mountpoint fd; format
      the 16-byte uuid canonically; set `metadata.subvolumeUuid`. `__has_include`-guarded;
      degrades silently on `ret < 0` (ENOTTY/EPERM/unsupported/missing header).
- [x] Tests: `src/linux/btrfs-subvolume.test.ts` — host-conditional skip-guard;
      confirmed `/` and `/home` return **different** `subvolumeUuid` on this btrfs host.
- [x] Verify: `node-gyp rebuild` clean + `npx jest src/linux/` (16 pass). Added
      `linux-headers` to the Alpine prebuild (`.github/workflows/build.yml`).

### Phase 3 — PhotoStructure: consume in the fallback path

- [ ] In `readVolumeUUID` (`src/core/volumes/VolumeUUID.ts`), when returning the hardware
      UUID fallback, use `v.subvolumeUuid ?? v.uuid` (thread `subvolumeUuid` through
      `VolumeLike` and `getVolumeMetadata_` in `FsMetadata.ts`).
- [ ] Confirm `.uuid`-file mounts are unchanged (no volsha drift → no migration).
- [ ] Keep the landed `volshaToMountPoints` union + `exists()` backstop.
- [ ] Tests: extend `src/core/fs/FsMetadata.spec.ts`; on this btrfs box, assert `/` and
      `/home` now yield **distinct** volshas when neither has a `.uuid`.
- [ ] Verify: `cd src/core && node dist/core/test/mocha-runner.js dist/core/fs/FsMetadata.spec.js`.

### Phase 4 — zfs (deferred)

- [ ] Evaluate whether zfs collides at all (dataset `mountFrom` is already distinct).
- [ ] If needed, populate `subvolumeUuid` from dataset `guid` (libzfs or `zfs get`),
      behind a capability check; document the extra dependency.

### Phase 5 — URI-carried subvolume identity (deferred, Option B)

- [ ] Only if legacy-row exactness / snapshot disambiguation becomes a real requirement.
