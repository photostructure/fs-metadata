# TPP: Linux file bind mounts

## Summary

Make public volume enumeration return directory mount targets while allowing
explicit path and mount-point metadata queries to honor Linux file bind mounts.

## Current phase

- [x] Research & Planning
- [x] Write breaking tests
- [x] Design alternatives
- [x] Task breakdown
- [x] Implementation
- [x] Review & Refinement
- [x] Final Integration
- [x] Review

## Required reading

- `AGENTS.md`
- `CONTRIBUTING.md`
- `doc/gotchas.md`
- `doc/TPP-GUIDE.md`
- `doc/C++_REVIEW_TODO.md`
- `doc/LINUX_API_REFERENCE.md`
- `src/volume_mount_points.ts`
- `src/volume_metadata.ts`
- `src/mount_point_for_path.ts`
- `src/linux/volume_metadata.cpp`

## Description

Docker bind-mounts files such as `/etc/hosts`, `/etc/hostname`, and
`/etc/resolv.conf`. Linux reports these as valid VFS mount points. They are
currently returned by `getVolumeMountPoints()` with `status: "unknown"`, even
though the public contract says enumeration contains readable directories.
They also cannot be queried because the TypeScript health probe uses
`opendir()` and the Linux worker opens paths with `O_DIRECTORY`.

The public enumerator should omit file mount targets. Explicit path resolution
must still use the raw mount table so that a mounted file resolves to itself,
and both metadata APIs must accept that valid mount target.

## Lore

- `/proc/self/mounts` does not say whether a mount target is a file or directory;
  the target must be probed.
- `skipNetworkVolumes: true` must retain its no-touch guarantee. Remote target
  kind is therefore unknown and such entries remain in public enumeration.
- `opendir()` distinguishes file targets with `ENOTDIR`, but health status must
  remain separate from path kind so inaccessible volumes are retained.
- `fstatvfs()` accepts a descriptor for an open file, not only a directory.
- `getMountPointForPath()` and `getVolumeMetadataForPath()` must request an
  unfiltered mount list internally; otherwise exact file mount boundaries are
  lost.
- The Btrfs subvolume-info ioctl may be unavailable on a regular-file fd and
  already degrades by leaving `subvolumeUuid` unset.
- Linux file-target probing now falls back from a directory descriptor to an
  `O_PATH` descriptor. `fstatvfs()`/`fstatfs()` work on that descriptor, while
  the directory-only Btrfs ioctl is skipped.
- Public enumeration omits local file targets after their kind is detected.
  With `skipNetworkVolumes: true`, unprobed remote targets remain visible as
  shallow `unknown` entries to preserve the documented no-touch guarantee.
- Validation passed on supported Node.js 24: TypeScript and native linting,
  CJS and ESM suites (554 passing tests each), docs and export checks, memory
  tests, Valgrind, ASan/LSan/UBSan, and TSan. A Docker run confirmed that
  `/etc/hosts`, `/etc/hostname`, and `/etc/resolv.conf` are omitted from public
  enumeration but remain queryable through explicit path APIs.
- `npm run all` was not invoked because the repository script updates
  dependencies and removes the lockfile. Its non-mutating validation gates
  were run individually instead.

## Solutions

### Option A (preferred): explicit internal directory filter

Add an internal-only `includeFileMounts`/directory-filter setting to mount
enumeration. Public `getVolumeMountPoints()` keeps it disabled for callers and
returns directories only. Path resolution enables raw file mounts. Classify
targets during the existing local health probe, avoiding a second filesystem
operation. Update Linux metadata probing to open readable files without
`O_DIRECTORY`.

Pros: one enumeration pipeline, exact path resolution, no Docker file noise,
no extra probe for normal mounts. Cons: internal option plumbing and Linux
native rebuild required.

### Option B: filter all `status !== "healthy"`

Simple but incorrect: it removes inaccessible, disconnected, and timed-out
directory volumes and conflates health with target type.

### Option C: always expose file mounts

Technically mirrors the Linux VFS but violates the existing cross-platform
directory-volume contract and makes `getAllVolumeMetadata()` noisy in every
ordinary Docker container.

## Tasks

- [x] Add deterministic unit tests for directory-only public enumeration while
      retaining inaccessible directories.
- [x] Add deterministic Linux coverage for exact file-mount path and metadata
      resolution using a synthetic mount table; retain Docker as final manual
      validation.
- [x] Separate target-kind probing from volume health status.
- [x] Preserve raw mount entries for internal path resolution.
- [x] Allow the Linux metadata worker to open regular-file mount targets safely.
- [x] Update public documentation and Linux gotchas.
- [x] Build and run focused/full tests plus equivalent non-mutating integration
      gates and memory checks.
- [x] Review the scoped diff and archive this TPP in `_done/`.
