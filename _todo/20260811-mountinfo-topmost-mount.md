# TPP: Resolve the topmost mount correctly under `mount --move`

## Summary

`lastMountEntriesByPath()` (`src/linux/mtab.ts`) picks the **last** entry for a
mount point, because every stacking mechanism we target appends. `mount --move`
re-attaches an already-attached mount without reallocating the internal mount ID
that orders `/proc/self/mounts`, so a moved mount can keep an earlier position
while sitting on top — and we would return the filesystem it hides.

This has **never been observed**. It came from code review, not a bug report.
Phase 1 is therefore to reproduce or refute it. "Refuted / not reachable on
supported kernels" is a perfectly good outcome: close as won't-fix, keep the
documentation, delete this TPP.

## Current phase

- [x] Research & Planning
- [ ] **Phase 1: reproduce or refute (GATE — do not proceed without a repro)**
- [ ] Write breaking tests
- [ ] Design alternatives
- [ ] Task breakdown
- [ ] Implementation
- [ ] Review & Refinement
- [ ] Final Integration

## Required reading

- `src/linux/mtab.ts` — `lastMountEntriesByPath()` and its caveat comment
- `src/linux/mount_points.ts` — both consumers (`getLinuxMountPoints()`,
  `getLinuxMtabMetadata()`)
- `src/linux/overmounts.test.ts` — existing fixture-driven coverage
- `doc/gotchas.md` → "systemd Automounts Appear Twice in the Mount Table"
- `CLAUDE.md` → "Linux Mount Table Stacking" (states the limitation)
- `man 5 proc` → `/proc/[pid]/mountinfo` field layout

## Description

One path can appear several times in the mount table. A systemd direct automount
keeps its `autofs` trigger and mounts the real filesystem over it; `mount --bind`
and overlay stacking behave the same way. All of these **append**, so last-wins
is correct for them, and it is what the library does today (commit `d72bba5`
replaced a first-wins read that reported `fstype: "autofs"` with no device, so
`uuid`/`label` came back empty).

`/proc/self/mounts` states no parent/child relationship between entries. File
order is therefore a proxy for stacking order, not a guarantee of it. The claimed
counterexample is `mount --move`: it detaches and reattaches an existing mount
without allocating a new ordering ID, so the moved mount keeps its old position
in the listing even though it is now the visible one at that path.

Resolving that properly requires `/proc/self/mountinfo`, which carries mount and
parent IDs.

## Lore

- **Do not "verify" ordering by reading the first column of `mountinfo`.** That
  column is `mnt_id`, which is _reusable_. Namespace iteration is ordered by a
  different, monotonic `mnt_id_unique`. A previous session measured `mnt_id`,
  found it non-monotonic, and wrongly concluded the whole concern was invalid.
  Kernel refs (v7.0 `fs/namespace.c`): unique-ID allocation ~L213-222, namespace
  iteration ~L1075-1104, proc iterator ~L1531-1561, move reattachment ~L2609-2645;
  `fs/proc_namespace.c` ~L135-145 prints `mnt_id`.
- **A two-`tmpfs` repro cannot work.** `stat -f -c %T` reports `tmpfs` for both,
  so you cannot tell which is visible. Use two different filesystems, or marker
  files, or `findmnt -o SOURCE`. Also note one `umount` leaves the lower mount
  mounted — unmount twice.
- `linuxMountTablePaths` defaults to `["/proc/self/mounts", "/proc/mounts",
"/etc/mtab"]`. There is **no `mountinfo` equivalent for `/etc/mtab`**, so
  mountinfo can only ever be a preferred source with the current list as
  fallback — not a replacement.
- `mountinfo` parsing is not `mounts` parsing: fields are
  `id parent major:minor root mountpoint opts [optional...] - fstype source
superopts`, where the optional-field run is **variable length** and terminated
  by a literal `-`. Splitting on whitespace by index will break.
- `parseMtab()` already handles octal escapes (`\040` etc.) via
  `decodeMountTableEscapes` — mountinfo uses the same escaping; reuse it.
- Root is required to create the repro, and CI does not run privileged. Any
  regression test that ships must be fixture-driven (see
  `src/linux/overmounts.test.ts` for the pattern) rather than requiring a real
  `mount --move`.
- `statmount()` / `listmount()` (Linux ≥ 6.8) expose unique mount IDs directly,
  but adopting them would raise the kernel floor — see Option C.

## Phase 1: reproduce or refute

Run as root on a supported kernel. Goal: make a _visible_ mount appear **before**
the entry it covers in `/proc/self/mounts`.

```bash
# two distinguishable filesystems, marker files, no tmpfs/tmpfs ambiguity
mkdir -p /tmp/mvA /tmp/mvB
mount -t ramfs ramfs /tmp/mvA && echo A > /tmp/mvA/marker
mount -t tmpfs tmpfs /tmp/mvB && echo B > /tmp/mvB/marker
mount --move /tmp/mvA /tmp/mvB          # older mount now on top of newer
grep ' /tmp/mvB ' /proc/self/mounts      # order: which line is first?
cat /tmp/mvB/marker                      # ground truth: which is visible?
findmnt -o TARGET,SOURCE,FSTYPE /tmp/mvB
umount /tmp/mvB; umount /tmp/mvB; rmdir /tmp/mvA /tmp/mvB
```

**Decision gate:**

- If `marker` prints `A` while the `A` line is **first** → confirmed, continue.
- If the visible mount is last → refuted on this kernel. Record the kernel
  version and outcome in this file, move it to `_done/`, and leave the
  documentation as-is. Consider also testing inside a container/`unshare -m`,
  since runtimes use `MOVE` during `pivot_root`.

## Solutions

### Option A (preferred, only if Phase 1 confirms)

Prefer `/proc/self/mountinfo` when readable; fall back to the existing list.

- New parser (`parseMountInfo()`), split on the `-` separator, not by index.
- Determine the visible mount per path using mount/parent IDs.
- Keep `lastMountEntriesByPath()` for the fallback sources — `/etc/mtab` has no
  mountinfo equivalent, and the fallback must not regress.
- Prepend `/proc/self/mountinfo` to `LinuxMountTablePathsDefault`, keyed on
  format detection so a caller-supplied `mounts`-format path still parses.

Cost: a second parser and a format-dispatch step on a core path that currently
works for every mechanism we actually target.

### Option B (cheaper, if the repro is exotic)

Keep last-wins. Detect the ambiguity instead of resolving it: when a path has
multiple entries, consult `mountinfo` only for that path. Bounded work, no
default change, no new hot-path parsing.

### Option C (rejected unless the floor moves)

`statmount()`/`listmount()` give unique mount IDs directly, but require Linux
≥ 6.8. The project supports older kernels, so this cannot be the only path.

## Tasks

- [ ] Phase 1: run the repro above; record kernel version and result here
- [ ] Phase 1: repeat under `unshare -m` / a container runtime
- [ ] **GATE:** if refuted, move this file to `_done/` and stop
- [ ] Add a fixture-driven failing test (no root) for the confirmed ordering
- [ ] Choose Option A or B; record why in this file
- [ ] Implement; verify `npm test` and `npx jest src/linux`
- [ ] Update `doc/gotchas.md`, `CLAUDE.md`, and the caveat in `src/linux/mtab.ts`
      — all three currently document this as an accepted limitation
- [ ] CHANGELOG entry
