# macOS System Volume Detection

## Background

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

## The Root Volume UUID Problem

The volume mounted at `/` is an **APFS sealed system snapshot** — a
cryptographically signed, read-only image of the OS. Its UUID changes on
every macOS update. This makes it unsuitable for persistent identification
(e.g., licensing fingerprints, asset URIs).

The **Data volume** at `/System/Volumes/Data` has a stable UUID and contains
all user data. Users access it transparently through APFS firmlinks (`/Users`,
`/Applications`, `/Library`, etc.).

## Detection Strategy

We use a two-layer approach:

### Layer 1: APFS volume roles via IOKit (C++, primary)

Each APFS volume has a **role** stored in its superblock (an unsigned 16-bit
integer). We read this via:

1. `DADiskCreateFromBSDName()` to get a DiskArbitration disk ref
2. `DADiskCopyIOMedia()` to get the IOKit IOMedia service
3. `IORegistryEntryCreateCFProperty(media, "Role")` to read the role array

For APFS snapshots (e.g., `/` is `disk3s7s1`, a snapshot of `disk3s7`), the
snapshot's IOMedia entry has no `Role` property — we walk one parent up in
the IOService plane to find the parent volume's role.

**System roles** (volumes with these roles are marked `isSystemVolume: true`):
System, VM, Preboot, Recovery, Update, Hardware, xART, Baseband, Prelogin,
Enterprise, Installer, Sidecar, Backup.

**User roles** (not marked as system): Data, None (or absent).

This approach is factual (Apple assigns the roles), not heuristic, and doesn't
depend on mount point paths.

### Layer 2: `MNT_SNAPSHOT` flag fallback (C++)

If a DiskArbitration session can't be created, we fall back to checking
`MNT_SNAPSHOT` in the `statfs` `f_flags`. This catches the sealed system
snapshots (`/` and `/System/Volumes/Recovery`) but misses the other
infrastructure volumes (VM, Preboot, etc.).

### Layer 3: Path and fstype heuristics (TypeScript)

The TypeScript `assignSystemVolume()` function applies path pattern and
filesystem type heuristics on top of the native detection. This catches:

- Linux pseudo-filesystems (`proc`, `sysfs`, `tmpfs`, etc.)
- Linux system paths (`/boot`, `/dev`, `/proc`, `/sys`, `/run/*`, etc.)
- Container runtime paths (Docker, containerd, Podman, etc.)
- The Windows system drive
- Pseudo-filesystems like `devfs` on macOS (no IOMedia, so no APFS role)

Native `isSystemVolume: true` is never downgraded by heuristics — only
upgraded from false to true.

## Why Not `MNT_DONTBROWSE`?

`MNT_DONTBROWSE` (the `nobrowse` mount flag) was considered as a native
signal to replace the path pattern heuristics. It's set on most
`/System/Volumes/*` mounts and means "hidden from Finder."

**It was rejected** because `/System/Volumes/Data` — the primary user data
volume — also has `MNT_DONTBROWSE` set. macOS hides it from Finder because
users are supposed to access their files through firmlinks (`/Users`,
`/Applications`), not by browsing `/System/Volumes/Data` directly.

Marking `/System/Volumes/Data` as a system volume would be wrong: it's where
all user photos, documents, and application data live. It has a stable UUID
and is the correct volume for persistent identification.

### Flag and role summary (observed on macOS 15 Sequoia)

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

## Related Files

- `src/darwin/system_volume.h` — IOKit role check + `MNT_SNAPSHOT` fallback
- `src/darwin/raii_utils.h` — RAII wrappers for DA/CF/IOKit resources
- `src/options.ts` — Path pattern and fstype heuristics (Linux, Windows, devfs)
- `src/system_volume.ts` — TypeScript system volume classification logic
- `src/types/mount_point.ts` — `MountPoint.isSystemVolume` / `isReadOnly` fields
