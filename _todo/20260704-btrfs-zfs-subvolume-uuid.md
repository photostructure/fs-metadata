---
title: Linux subvolume and dataset identity metadata
status: todo
created: 2026-07-04
---

# TPP: Linux subvolume and dataset identity metadata

## Summary

Linux filesystems can expose mounted units that do not have a distinct block
device UUID. Btrfs subvolumes share one filesystem UUID, while ZFS datasets do
not resolve through libblkid at all. This project needs additive fields that let
consumers distinguish those units without changing the existing `uuid` field or
making external commands part of the default path.

## Current phase

- [x] Research btrfs and ZFS identity semantics.
- [x] Add btrfs mount-option and subvolume UUID fields.
- [x] Add the quick ZFS `fsid` field.
- [x] Correct the public `fsid` persistence contract.
- [x] Add opt-in ZFS dataset and pool GUID fields.
- [x] Run unit, integration, native-build, type, lint, format, and docs checks.
- [ ] Publish version 2.3.0.
- [ ] Confirm clean-install CI, then move this TPP to `_done`.

## Required reading

- `CLAUDE.md`
- `CONTRIBUTING.md`
- `doc/gotchas.md`
- `doc/subvolume-identity.md`
- `src/types/mount_point.ts`
- `src/types/volume_metadata.ts`
- `src/types/options.ts`
- `src/linux/mtab.ts`
- `src/linux/volume_metadata.cpp`
- `src/linux/zfs_guids.ts`
- `src/volume_metadata.ts`

## Public API

All fields are additive. `uuid` remains the filesystem or volume UUID.

### Btrfs

- `MountPoint.subvol?: string`: the `subvol=` mount option.
- `MountPoint.subvolid?: number`: the `subvolid=` mount option.
- `VolumeMetadata.subvolumeUuid?: string`: the per-subvolume UUID from
  `BTRFS_IOC_GET_SUBVOL_INFO`.

The ioctl runs only when the Linux mount table identifies the filesystem as
btrfs. It is unprivileged on supported kernels and silently leaves the field
undefined when the ioctl or header is unavailable.

### ZFS quick path

- `VolumeMetadata.fsid?: string`: Linux `statfs(2).f_fsid`, rendered as 16
  lowercase hexadecimal characters.

This path uses the already-open mountpoint descriptor and no external command.
The value is normally stable across remount, reboot, import, and dataset rename,
but OpenZFS may remap it to resolve an active collision. It is a useful current
identity or fallback, not an immutable identifier.

### ZFS authoritative path

Set `includeZfsGuids: true` to request:

- `VolumeMetadata.zfsDatasetGuid?: string`
- `VolumeMetadata.zfsPoolGuid?: string`

Both are unsigned 64-bit decimal strings. The dataset query is:

```
zfs get -Hp -o value guid <dataset>
```

The pool query is:

```
zpool get -Hp -o value guid <pool>
```

Commands run with `execFile`, no shell, a 4 KiB output limit, and the remaining
metadata deadline. Each field fails open. On timeout, the runner sends SIGTERM,
closes its pipes, unreferences the child, and settles independently of process
exit; it deliberately does not use SIGKILL. Concurrent pool queries
share an in-flight process when its remaining timeout budget covers the caller;
each caller retains its own deadline. No completed result is cached, so a later
`zpool reguid` remains observable.

## Research findings

### Btrfs

- Libblkid keys on the block device, so sibling subvolumes correctly share the
  same filesystem `uuid`.
- `subvol` paths change on rename. `subvolid` is local to one filesystem and is
  not preserved by send/receive.
- `BTRFS_IOC_GET_SUBVOL_INFO` provides the strongest local subvolume identity.
  The ioctl returns a positive value on success on the verified host, so only a
  negative return indicates failure.
- `<linux/btrfs.h>` is not universally installed. The implementation uses an
  `__has_include` guard, and Alpine prebuilds install `linux-headers`.

### ZFS

- A mounted dataset appears in the Linux mount table as a source such as
  `tank/home`. Libblkid cannot resolve that dataset name to a block device, so
  ZFS metadata normally has no `uuid`.
- Linux ZFS copies `dmu_objset_fsid_guid()` into `statfs().f_fsid`.
  `ds_fsid_guid` is a 56-bit collision-avoiding value that OpenZFS may replace
  and later persist when duplicate active datasets collide.
- `zfs get guid` returns the dataset GUID. Split replicas initially retain the
  same dataset lineage, so consumers that need copy-specific identity can
  combine it with `zpool get guid`.
- `zpool reguid` is an explicit administrative operation. Routine reboot,
  import, scrub, resilver, and disk replacement do not invoke it.

## Implementation notes

### Btrfs phases, shipped in 2.1.0

- `src/linux/mtab.ts` parses `subvol` and `subvolid` only for btrfs entries and
  carries them through both mountpoint and metadata conversion paths.
- `src/linux/volume_metadata.cpp` reuses the mountpoint file descriptor for
  `BTRFS_IOC_GET_SUBVOL_INFO` and formats the UUID canonically.
- `src/linux/btrfs-subvolume.test.ts` checks consistency for repeated mounts of
  one subvolume and distinction between sibling subvolume IDs.

### ZFS `fsid`, shipped in 2.1.0

- `src/linux/volume_metadata.cpp` gates `fstatfs()` on `fstype === "zfs"` and
  reconstructs the two 32-bit words into the documented hexadecimal string.
- The original docs overstated this value as persistent. The contract is now
  corrected in types, comments, changelog, gotchas, and subvolume docs.

### Opt-in GUID enrichment, pending 2.3.0

- `src/linux/zfs_guids.ts` validates dataset input, parses GUIDs without number
  precision loss, runs both commands in parallel, and handles failures per
  field.
- A separate promise deadline protects the fail-open contract even if a command
  ignores SIGTERM or is stuck in uninterruptible kernel IO. Timed-out production
  children have their pipes closed and are unreferenced so they cannot hold the
  Node process open.
- Containers that see host ZFS mounts without `/dev/zfs` skip the commands
  immediately.
- `src/volume_metadata.ts` starts enrichment only for Linux ZFS metadata with a
  nonblank dataset source. It preserves the absolute deadline established by
  `getVolumeMetadataForPath()` and leaves 250 ms for timeout cleanup and
  final result assembly.
- `includeZfsGuids` defaults to `false` and is accepted by
  `getVolumeMetadata()`, `getVolumeMetadataForPath()`, and
  `getAllVolumeMetadata()`.
- The new flag is optional on the existing `Options` interface for source
  compatibility. `ResolvedOptions` requires it after defaults are applied.

## Live verification

The local host has three mounted ZFS datasets:

```
/mnt/zfstest
/mnt/zfstest/alpha
/mnt/zfstest/beta
```

An end-to-end lookup of `/mnt/zfstest/alpha` returned:

```
fsid:           0068b05f38645c29
zfsDatasetGuid: 1179593054938739425
zfsPoolGuid:    456694310884881729
```

The root, alpha, and beta datasets share the pool GUID and have distinct dataset
GUIDs. The default lookup leaves both opt-in fields undefined.

## Verification completed

- Targeted ZFS/options tests passed, including parsing, exact command arguments,
  partial failure, malformed input, timeout isolation, and in-flight caching.
- The live ZFS integration test passed with host `/dev/zfs` access.
- Complete CJS suite: 42 suites passed, 569 tests passed, 76 skipped.
- Complete ESM suite: 42 suites passed, 569 tests passed, 76 skipped.
- `npx tsc --noEmit --pretty false` passed.
- Targeted ESLint and Prettier checks passed.
- Distribution declarations built and `npm run check:exports` found no export
  or module-format problems.
- `npm run node-gyp-rebuild` passed.
- TypeDoc generated with its existing unrelated `HideMethods` warning.

## Release tasks

- [ ] Update the package version through the normal release process.
- [ ] Run `npm run prepare-release` and the clean package/export checks.
- [ ] Publish 2.3.0 and verify the registry tarball exposes the new option and
      fields in both CJS and ESM declarations.
- [ ] Confirm release CI on supported Linux, macOS, and Windows targets.
- [ ] Move this file to `_done`.
