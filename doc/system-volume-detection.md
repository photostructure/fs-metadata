# System Volume Detection

## Overview

`fs-metadata` uses a two-layer detection strategy across all platforms:

1. **Layer 1 (C++, native)** — platform-specific APIs detect system volumes at
   enumeration time. Each `MountPoint` gets `isSystemVolume` set by native code.
2. **Layer 2 (TypeScript, heuristic)** — path patterns and filesystem type lists
   catch pseudo-filesystems, container runtimes, and platform-specific system
   paths. Heuristics **never downgrade** a native `true` — they only upgrade
   `false` to `true`.

The `isSystemVolume` field is exposed on both `MountPoint` and `VolumeMetadata`.

By default, system volumes are **excluded** from `getAllVolumeMetadata()` results
on Linux and macOS (`includeSystemVolumes: false`), but **included** on Windows
because `C:\` is both a system drive and the primary user storage location.

---

## macOS

### Background

On macOS 10.15 (Catalina) and later, the boot volume is split into multiple
APFS volumes within a single container:

| Volume              | Mount Point                  | APFS Role | Description                                               |
| ------------------- | ---------------------------- | --------- | --------------------------------------------------------- |
| Macintosh HD        | `/` (snapshot)               | System    | Sealed, read-only OS snapshot                             |
| Macintosh HD - Data | `/System/Volumes/Data`       | Data      | User data (firmlinked to `/Users`, `/Applications`, etc.) |
| VM                  | `/System/Volumes/VM`         | VM        | Virtual memory swap                                       |
| Preboot             | `/System/Volumes/Preboot`    | Preboot   | Boot-time resources                                       |
| Recovery            | `/System/Volumes/Recovery`   | Recovery  | Recovery OS                                               |
| Update              | `/System/Volumes/Update`     | Update    | OS update staging                                         |
| Hardware            | `/System/Volumes/Hardware`   | Hardware  | Hardware-specific data                                    |
| xarts               | `/System/Volumes/xarts`      | xART      | Secure token storage                                      |
| iSCPreboot          | `/System/Volumes/iSCPreboot` | Prelogin  | Pre-login resources                                       |

### The Root Volume UUID Problem

The volume mounted at `/` is an **APFS sealed system snapshot** — a
cryptographically signed, read-only image of the OS. Its UUID changes on
every macOS update. This makes it unsuitable for persistent identification
(e.g., licensing fingerprints, asset URIs).

The **Data volume** at `/System/Volumes/Data` has a stable UUID and contains
all user data. Users access it transparently through APFS firmlinks (`/Users`,
`/Applications`, `/Library`, etc.).

### Native detection (Layer 1)

Detection uses a combined formula:

```
isSystemVolume = MNT_SNAPSHOT || (MNT_DONTBROWSE && hasApfsRole && role != "Data")
```

This is implemented in `ClassifyMacVolume()` in `src/darwin/system_volume.h`.

Each APFS volume has a **role** stored in its superblock (an unsigned 16-bit
integer). We read this via:

1. `DADiskCreateFromBSDName()` to get a DiskArbitration disk ref
2. `DADiskCopyIOMedia()` to get the IOKit IOMedia service
3. `IORegistryEntryCreateCFProperty(media, "Role")` to read the role array

For APFS snapshots (e.g., `/` is `disk3s7s1`, a snapshot of `disk3s7`), the
snapshot's IOMedia entry has no `Role` property — we walk one parent up in
the IOService plane to find the parent volume's role.

The role string is exposed as `volumeRole` in both `MountPoint` and
`VolumeMetadata` (e.g., `"System"`, `"Data"`, `"VM"`).

**System volume classification** combines two signals:

- **`MNT_SNAPSHOT`** alone marks a volume as system. This catches sealed APFS
  snapshots (`/` and Recovery).
- **`MNT_DONTBROWSE`** combined with a non-`"Data"` APFS role marks a volume
  as system. This catches all infrastructure volumes (VM, Preboot, Update,
  Hardware, xART, etc.) while correctly excluding the Data volume.

**Why this works**: `MNT_DONTBROWSE` means "hidden from Finder" and is set on
all `/System/Volumes/*` infrastructure mounts. The only false positive would
be `/System/Volumes/Data`, which has `MNT_DONTBROWSE` but a `"Data"` role —
so the role check excludes it.

**Why not a role whitelist?** The previous approach maintained a whitelist of
13 system role strings. The flags+exclusion approach is simpler and
future-proof: if Apple adds new infrastructure roles with `MNT_DONTBROWSE`,
they're auto-detected without code changes.

**Non-APFS `MNT_DONTBROWSE` mounts** (e.g., `devfs` at `/dev`, or a
hypothetical NFS mount with `nobrowse`) have no APFS role, so the
`MNT_DONTBROWSE` branch doesn't fire. These fall through to TypeScript
heuristics (Layer 2).

### Native fallback: `MNT_SNAPSHOT` only

If a DiskArbitration session can't be created, we fall back to checking only
`MNT_SNAPSHOT` in the `statfs` `f_flags`. This catches the sealed system
snapshots (`/` and `/System/Volumes/Recovery`) but misses the other
infrastructure volumes (VM, Preboot, etc.).

### Flag and role summary (observed on macOS 26 Tahoe)

| Mount Point                  | APFS Role           | MNT_SNAPSHOT | MNT_DONTBROWSE | isSystemVolume   |
| ---------------------------- | ------------------- | ------------ | -------------- | ---------------- |
| `/`                          | System (via parent) | **yes**      | no             | **yes**          |
| `/System/Volumes/Data`       | Data                | no           | **yes**        | no               |
| `/System/Volumes/VM`         | VM                  | no           | **yes**        | **yes**          |
| `/System/Volumes/Preboot`    | Preboot             | no           | **yes**        | **yes**          |
| `/System/Volumes/Recovery`   | Recovery            | **yes**      | no             | **yes**          |
| `/System/Volumes/Update`     | Update              | no           | **yes**        | **yes**          |
| `/System/Volumes/xarts`      | xART                | no           | **yes**        | **yes**          |
| `/System/Volumes/iSCPreboot` | Prelogin            | no           | **yes**        | **yes**          |
| `/System/Volumes/Hardware`   | Hardware            | no           | **yes**        | **yes**          |
| `/dev`                       | _(no IOMedia)_      | no           | **yes**        | **yes** (fstype) |
| `/Volumes/sandisk-extreme`   | _(no role)_         | no           | no             | no               |

---

## Linux

### Background

Linux has no unified "system volume" concept. Instead, the kernel exposes
dozens of pseudo-filesystems for kernel interfaces, and distributions mount
various infrastructure paths at boot. Container runtimes add additional
overlay and bind mounts.

There is **no native C++ system volume detection** on Linux. All
classification happens in TypeScript (Layer 2) using filesystem type matching
and path pattern globs.

### Why no native detection?

Unlike macOS (which has APFS roles and `MNT_SNAPSHOT`/`MNT_DONTBROWSE` flags)
or Windows (which has `CSIDL_WINDOWS` and volume capability flags), Linux has
no kernel API that directly identifies "this is a system volume." The closest
signal is the filesystem type from `/proc/self/mounts`, which is already
available in TypeScript without a native call.

### Filesystem type detection

The `SystemFsTypesDefault` list in `src/options.ts` identifies pseudo-filesystems
that don't represent real storage:

| Category                  | Filesystem Types                                                       |
| ------------------------- | ---------------------------------------------------------------------- |
| Process/kernel interfaces | `proc`, `sysfs`, `debugfs`, `tracefs`, `configfs`, `securityfs`, `bpf` |
| Device pseudo-filesystems | `devpts`, `devtmpfs`                                                   |
| Memory/temporary          | `tmpfs`, `ramfs`, `rootfs`, `hugetlbfs`                                |
| Cgroups                   | `cgroup`, `cgroup2`                                                    |
| Boot/firmware             | `efivarfs`, `pstore`, `binfmt_misc`                                    |
| Automount                 | `autofs`, `fusectl`                                                    |
| Container/sandbox         | `fuse.lxcfs`, `fuse.portal`, `fuse.snapfuse`, `squashfs`               |
| Kernel internal           | `nsfs`, `mqueue`, `rpc_pipefs`, `none`                                 |

### Path pattern detection

The `SystemPathPatternsDefault` list in `src/options.ts` catches system mount
points by path glob:

| Category           | Patterns                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core system        | `/boot`, `/boot/efi`, `/dev`, `/dev/**`, `/proc/**`, `/sys/**`                                                                                                |
| Runtime            | `/run`, `/run/lock`, `/run/credentials/**`                                                                                                                    |
| Temporary          | `/tmp`, `/var/tmp`                                                                                                                                            |
| Container runtimes | `/run/docker/**`, `/var/lib/docker/**`, `/run/containerd/**`, `/var/lib/containerd/**`, `/run/containers/**`, `/var/lib/containers/**`, `/var/lib/kubelet/**` |
| Linux containers   | `/var/lib/lxc/**`, `/var/lib/lxd/**`                                                                                                                          |
| Snap/Flatpak       | `/snap/**`, `/run/snapd/**`, `/run/flatpak/**`, `/run/user/*/doc`, `/run/user/*/gvfs`                                                                         |
| WSL infrastructure | `/mnt/wslg/distro`, `/mnt/wslg/doc`, `/usr/lib/wsl/drivers`                                                                                                   |
| Snapshot dirs      | `**/#snapshot`                                                                                                                                                |

### Typical detection results

| Mount Point                    | fstype     | Detected By   | isSystemVolume |
| ------------------------------ | ---------- | ------------- | -------------- |
| `/`                            | `ext4`     | _(none)_      | no             |
| `/boot`                        | `ext4`     | path          | **yes**        |
| `/boot/efi`                    | `vfat`     | path          | **yes**        |
| `/dev`                         | `devtmpfs` | fstype + path | **yes**        |
| `/proc`                        | `proc`     | fstype + path | **yes**        |
| `/sys`                         | `sysfs`    | fstype + path | **yes**        |
| `/run`                         | `tmpfs`    | fstype + path | **yes**        |
| `/tmp`                         | `tmpfs`    | fstype + path | **yes**        |
| `/home`                        | `ext4`     | _(none)_      | no             |
| `/var/lib/docker/overlay2/...` | `overlay`  | path          | **yes**        |
| `/mnt/data`                    | `ext4`     | _(none)_      | no             |

### Customization

Both lists are configurable via `Options.systemFsTypes` and
`Options.systemPathPatterns`, allowing callers to add or replace detection
rules for specialized environments.

---

## Windows

### Background

Windows has a simpler model: drives are identified by letter (`C:\`, `D:\`,
etc.), and one drive is the "system drive" containing the Windows
installation. Unlike macOS's split-volume architecture, the system drive also
holds user data (`C:\Users`).

### Native detection (Layer 1)

`IsSystemVolume()` in `src/windows/system_volume.h` uses two checks:

1. **`SHGetFolderPathW(CSIDL_WINDOWS)`** — retrieves the Windows system
   folder path (e.g., `C:\Windows`), extracts the drive letter, and compares
   it against the volume being tested. This is the primary detection method.

2. **Volume capability flags** — calls `GetVolumeInformationW()` and checks
   for `FILE_SUPPORTS_SYSTEM_PATHS` (0x00100000) and
   `FILE_SUPPORTS_SYSTEM_FILES` (0x00200000). These are modern (Windows 10+)
   volume flags that indicate system volume capabilities.

### TypeScript detection (Layer 2)

The TypeScript layer (`src/system_volume.ts`) provides a redundant check using
`process.env.SystemDrive` (typically `"C:"`), normalized to `"C:\"` for
comparison.

### Why `includeSystemVolumes` defaults to `true` on Windows

On macOS and Linux, system volumes (pseudo-filesystems, sealed snapshots) are
genuinely uninteresting to most callers. On Windows, `C:\` is both the system
drive _and_ the primary user storage location — excluding it would hide the
most important volume. So `IncludeSystemVolumesDefault = true` on Windows
(see `src/options.ts`).

### Typical detection results

| Mount Point      | Detection Method            | isSystemVolume |
| ---------------- | --------------------------- | -------------- |
| `C:\`            | CSIDL_WINDOWS + SystemDrive | **yes**        |
| `D:\`            | _(none)_                    | no             |
| `E:\`            | _(none)_                    | no             |
| `\\server\share` | _(none)_                    | no             |

---

## Layer 2: TypeScript heuristics (all platforms)

The `assignSystemVolume()` function in `src/system_volume.ts` runs after native
enumeration and applies the shared heuristic layer:

1. On Windows, checks `process.env.SystemDrive`
2. Checks `fstype` against `SystemFsTypesDefault` (configurable)
3. Checks `mountPoint` against `SystemPathPatternsDefault` glob patterns
   (configurable)

Native `isSystemVolume: true` is **never downgraded** — only upgraded from
`false` to `true`.

## Related Files

- `src/darwin/system_volume.h` — `ClassifyMacVolume()`: macOS flags + APFS role detection
- `src/darwin/raii_utils.h` — RAII wrappers for DA/CF/IOKit resources
- `src/windows/system_volume.h` — `IsSystemVolume()`: Windows CSIDL + volume flags
- `src/options.ts` — `SystemFsTypesDefault`, `SystemPathPatternsDefault`, `IncludeSystemVolumesDefault`
- `src/system_volume.ts` — `isSystemVolume()`, `assignSystemVolume()`: TypeScript heuristic layer
- `src/types/mount_point.ts` — `MountPoint.volumeRole` / `isSystemVolume` / `isReadOnly` fields
