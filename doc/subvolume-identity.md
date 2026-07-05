# Subvolume Identity (btrfs)

## The problem

`libblkid` keys the volume `uuid` on the **block device**, not the mount. On
btrfs, several mount points can be distinct **subvolumes** of one filesystem
(one device), so `getVolumeMetadata()` reports the **same `uuid`** for all of
them:

```
findmnt:  /      /dev/nvme0n1p2[/@]      btrfs  UUID 9486d442-…
          /home  /dev/nvme0n1p2[/@home] btrfs  UUID 9486d442-…

getVolumeMetadata:
  /      { uuid: 9486d442-…, mountFrom: /dev/nvme0n1p2 }
  /home  { uuid: 9486d442-…, mountFrom: /dev/nvme0n1p2 }   ← same uuid + device
```

This is **correct behavior for blkid** (it is the _filesystem_ UUID), but it
means the `uuid` field alone cannot distinguish sibling subvolumes. Consumers
that derive a persistent volume identity from `uuid` will collide across
siblings.

## The additive discriminators

fs-metadata exposes three optional, additive fields (all `undefined` off btrfs;
no consumer breaks). `uuid` is never changed — it stays the filesystem UUID.

| Field           | Type     | Source                            | Tier         | Stability                                                                                                                                     |
| --------------- | -------- | --------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `subvol`        | `string` | `subvol=` mount option            | mount-option | changes on subvolume rename/move                                                                                                              |
| `subvolid`      | `number` | `subvolid=` mount option          | mount-option | stable per-fs; **not** unique across filesystems; **not** preserved by `send`/`receive`                                                       |
| `subvolumeUuid` | `string` | `BTRFS_IOC_GET_SUBVOL_INFO` ioctl | ioctl        | **strongest**: stable across remount/reboot; `send`/`receive` preserves source as `received_uuid`; snapshots get a fresh uuid + `parent_uuid` |

`subvol` / `subvolid` live on `MountPoint` (available from both
`getVolumeMountPoints()` and `getVolumeMetadata()`). `subvolumeUuid` lives on
`VolumeMetadata` (it requires the metadata ioctl).

### Mount-option tier

btrfs records the subvolume in the **options** field of `/proc/self/mounts`, not
the device field:

```
/dev/nvme0n1p2 /     btrfs rw,…,subvolid=256,subvol=/@
/dev/nvme0n1p2 /home btrfs rw,…,subvolid=257,subvol=/@home
```

`parseSubvolInfo()` in `src/linux/mtab.ts` extracts `subvol` and `subvolid`.
This is cheap (no new syscalls) and gives `(uuid, subvolid)` — enough to
_distinguish_ siblings on the local machine.

### Ioctl tier

`BTRFS_IOC_GET_SUBVOL_INFO` (kernel ≥ 4.18, **unprivileged**) returns the
subvolume's own UUID from its root item. `src/linux/volume_metadata.cpp` calls
it on the already-open mount-point fd when `fstype === "btrfs"`, and formats the
16 raw bytes as a canonical lowercase hyphenated UUID into `subvolumeUuid`.

Notes for maintainers:

- **The ioctl returns a positive value (observed `1`) on success**, not `0` — so
  only a **negative** return is treated as failure. Non-btrfs paths / old
  kernels yield `ENOTTY`/`EINVAL`/`EPERM` and we degrade silently.
- The UAPI header `<linux/btrfs.h>` is present on glibc distros
  (`linux-libc-dev`, pulled in by `build-essential`) and on Alpine when
  `linux-headers` is installed. The include is guarded with `__has_include`, so
  a build without the header still compiles — the feature is just unavailable
  and `subvolumeUuid` stays `undefined`.

## Filesystem landscape (all platforms)

The bug this feature fixes is specific: **N sibling subvolumes of ONE filesystem
on ONE block device, all sharing that filesystem's UUID**, distinguishable only
by mount options / an ioctl. Only **btrfs** produces exactly that shape. Many
filesystems have subvolume-_like_ features, but they either give each unit its
own identity (so nothing collides) or don't surface as separate mounts.

### Linux

| Filesystem / tech            | Subvolume-like concept                 | Collides like btrfs? | Rationale                                                                                                                                                                                                                                                            |
| ---------------------------- | -------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **btrfs**                    | Subvolumes + snapshots (native)        | **Yes — the bug**    | N subvolumes share one block-device fs UUID; the discriminator is in mount options; the strong id needs an ioctl.                                                                                                                                                    |
| **ZFS**                      | Datasets / snapshots / clones          | No                   | Each dataset mounts with its **dataset name** (`tank/home`) as the source, so `mountFrom` is already per-dataset distinct and blkid never assigns a colliding device UUID. Strong id is the 64-bit dataset **`guid`** (`zfs get guid`) — see the deferred zfs phase. |
| **bcachefs**                 | Subvolumes + snapshots (btrfs-like UI) | No                   | Addressed as **subdirectories within one mount** (`X-mount.subdir`); no per-mount `subvol=`/`subvolid=` token in `/proc/mounts`, so siblings are not separate colliding entries.                                                                                     |
| **NILFS2**                   | Checkpoints / snapshots                | No                   | Mounted read-only with `cp=<n>` — point-in-time, not a namespace of live sibling volumes.                                                                                                                                                                            |
| **Stratis** (XFS on thin dm) | Filesystems + snapshots                | No                   | Each Stratis filesystem/snapshot gets its **own** UUID, so siblings don't collide.                                                                                                                                                                                   |
| **CephFS**                   | Named "subvolumes" (CSI)               | No                   | Directories with quotas in a network filesystem — no block device, no blkid UUID.                                                                                                                                                                                    |
| **XFS / ext4 / f2fs / …**    | None                                   | No                   | XFS/ReFS-style reflink is block sharing, not a subvolume namespace.                                                                                                                                                                                                  |

### macOS

| Filesystem / tech | Subvolume-like concept                                             | Collides like btrfs? | Rationale                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **APFS**          | Multiple **volumes** share a container's space; APFS **snapshots** | No                   | The closest analog to btrfs — volumes in one container share free space — **but each APFS volume has its own unique volume UUID**, so identity is already correct. The sealed read-only system snapshot at `/` (whose UUID rotates every OS update) is handled separately; see [system-volume-detection.md](./system-volume-detection.md). |

### Windows

| Filesystem / tech                 | Subvolume-like concept           | Collides like btrfs? | Rationale                                                                                          |
| --------------------------------- | -------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| **ReFS**                          | Block cloning (reflink-style)    | No                   | Extent sharing between files, not a subvolume namespace; each ReFS volume has its own volume GUID. |
| **Storage Spaces**                | Storage virtualization / pools   | No                   | A pool can back many volumes, but each volume still has its own GUID.                              |
| **NTFS mount points / junctions** | One volume mounted at many paths | N/A                  | Same volume at multiple paths reports the same GUID — correct, not a collision.                    |

The mount-option fields (`subvol` / `subvolid`) are the literal btrfs mount
option token names and are btrfs-only by construction — `parseSubvolInfo` yields
nothing for other filesystems. `subvolumeUuid` is named generically on purpose:
it is the "strongest per-subvolume identity" slot, and a future zfs
implementation can populate the same field from the dataset `guid`.

### Related but different: duplicate fs UUID across two devices

A separate hazard, **not** addressed by this feature: **LVM / device-mapper
snapshots** duplicate the origin's _filesystem_ (not just its blocks), so the
origin LV and the snapshot LV carry the **same filesystem UUID on two different
block devices**. `blkid` reports them as duplicates, and the kernel refuses to
mount both simultaneously (e.g. XFS "Filesystem has duplicate UUID … can't
mount"). This is a duplicate-UUID-across-devices problem, not a
subvolumes-share-one-device problem — there is no `subvol`/`subvolid` to key on,
and the storage-layer fix is `mount -o nouuid` or regenerating the UUID
(`xfs_admin -U generate`). Consumers that see two mounts with an identical `uuid`
should be aware this can arise from LVM/dm snapshots as well as btrfs siblings.

## Related files

- `src/linux/mtab.ts` — `parseSubvolInfo()`: mount-option tier.
- `src/linux/volume_metadata.cpp` — `BTRFS_IOC_GET_SUBVOL_INFO`: ioctl tier.
- `src/types/mount_point.ts` — `subvol` / `subvolid` fields.
- `src/types/volume_metadata.ts` — `subvolumeUuid` field.
- `src/linux/btrfs-subvolume.test.ts` — integration coverage (host-conditional).
