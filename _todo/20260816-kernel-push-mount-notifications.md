# TPP: Kernel-push mount notifications

## Summary

`watchVolumeMountPoints()` detects mount changes only when its timer fires, so
the default latency is up to 60 s. Every platform we support can push a
mount-table-changed signal to an unprivileged process. Deliver that signal as an
invalidation hint that triggers the existing reconciler immediately, keeping the
timer as a lower-frequency safety net. This is "Iteration 1: Native event
backends" from `_done/20260805-volume-mount-subscriptions.md`, deferred there and
now measured on all three platforms.

## Current phase

- [x] Research & Planning
- [ ] Write breaking tests
- [x] Design alternatives
- [ ] Task breakdown
- [ ] Implementation
- [ ] Review & Refinement
- [ ] Final Integration
- [ ] Review

## Required reading

- `_done/20260805-volume-mount-subscriptions.md` — the polling design this extends
- `src/polling_watcher.ts` — `PollingWatcher`, the lifecycle to extend
- `src/volume_mount_watcher.ts` — `watchVolumeMountPointsImpl`, the reconciler
- `src/available_space_watcher.ts` — the other `PollingWatcher` consumer
- `src/common/shutdown.h` — per-`napi_env` instance data and teardown flag
- `src/binding.cpp` — native entry points, per-platform `#if` layout
- `src/options.ts` — `LinuxMountTablePathsDefault`
- `doc/native-hardening.md` — flag matrix; new native files inherit it
- `doc/gotchas.md`, `doc/TPP-GUIDE.md`

## Description

The push signal is an *invalidation hint*, not an event log. On no platform does
the notification identify which mount changed in terms this library can consume
directly, and on every platform some class of change is missed. So the contract
stays exactly what it is today — snapshot, diff, emit `added`/`removed` — and the
only thing that changes is *when* a snapshot is taken. That keeps this additive:
no public type changes, and a caller who sets `pollIntervalMs` keeps the same
guarantee they have now, just with faster detection in the common case.

The safety-net poll must not be removed. Each platform has at least one path that
produces no push (documented per-platform below), and a wedged or undelivered
notification would otherwise strand the watcher permanently.

## Lore

All findings below were measured on 2026-08-15 with standalone probes, then
re-verified end to end from real Node through a scratch N-API addon. Platforms:
this Linux box (kernel 7.0.0-28-generic), `m1` (macOS 26.6.1, arm64), `swift`
(Windows 10.0.26200, x64, **non-elevated**). No mechanism needed privilege.

### Linux — `poll`/`epoll` on the procfs mount table

- `/proc/self/mounts` and `/proc/self/mountinfo` both report
  `POLLPRI | POLLERR` (`revents=0xa`) once per mount-table change. Verified
  inside `unshare -Umr` with `mount --bind` / `umount`.
- **Register for `EPOLLPRI` only. Never `EPOLLIN`.** These files are always
  readable, so `EPOLLIN` busy-loops: the probe took 38,076 wakes in 5 s
  (~7,600/s) versus 2 wakes for the same two mount changes with `EPOLLPRI`.
  Level-triggered `EPOLLPRI` does not spin, because the kernel updates the
  file's stored poll event counter on each poll.
- **libuv already handles the `POLLPRI|POLLERR` pair.** This is the risk that
  had to be measured: `uv__poll_io()` maps a bare `POLLERR` to `UV_EBADF` and
  tears the handle down. It does not do so when `POLLPRI` is also set. A real
  addon using `uv_poll_start(UV_PRIORITIZED)` received `status=0, events=8`
  (`UV_PRIORITIZED`) for both a bind mount and its unmount. **So Linux needs no
  dedicated thread and no ThreadSafeFunction** — it runs on the loop thread.
- Re-read the file to EOF (`lseek(0)` + drain) on each wake; it is a seq_file.
- **Bursts do not coalesce.** 20 bind mounts followed by 20 unmounts produced
  40 separate wakes when the reader kept up. Debounce is required, or a
  `mount -a` turns into 40 full enumerations.
- Watch `/proc/self/mounts` directly rather than whatever
  `linuxMountTablePaths` resolves to. A caller who points that option at a
  regular file (`/etc/mtab` on an old system) gets no `POLLPRI`; detect that and
  fall back to poll-only rather than silently never firing.
- The signal is scoped to the caller's mount namespace, which matches the
  semantics `getVolumeMountPoints()` already has.

### macOS — `kqueue` + `EVFILT_FS`

- `EV_SET(&kev, 0, EVFILT_FS, EV_ADD | EV_CLEAR, 0, 0, NULL)` delivers
  `VQ_MOUNT` (0x8) on `hdiutil attach` and `VQ_UNMOUNT` (0x10) on detach. No
  CFRunLoop, no AppKit, no DiskArbitration session, no privilege. `VQ_*`
  constants come from `<sys/mount.h>`.
- The event carries **no identity** — no path, no device. It is purely "the set
  of mounts changed, re-enumerate."
- **The kqueue descriptor is itself pollable.** `poll(kq, POLLIN)` returns
  readable exactly once per FS event, and a real addon using
  `uv_poll_start(UV_READABLE)` on the kqueue fd received `status=0, events=1`
  for both attach and detach, draining with a zero-timeout `kevent()`. **So
  macOS also needs no dedicated thread.**
- This is the same primitive `NSWorkspace`'s mount notifications are built on,
  reachable without linking AppKit.
- Other `VQ_*` bits arrive on the same filter (`VQ_UPDATE`, `VQ_LOWDISK`,
  `VQ_VERYLOWDISK`, `VQ_NOTRESP`, …). Filter to `VQ_MOUNT | VQ_UNMOUNT` for the
  mount watcher. `VQ_LOWDISK` / `VQ_VERYLOWDISK` / `VQ_FREE_SPACE_CHANGE` are a
  possible later input to `watchAvailableSpace()`, but they are macOS-only and
  fire against system-chosen thresholds, not the caller's — out of scope here.

### Windows — hidden top-level window + `WM_DEVICECHANGE`

Two candidates were registered simultaneously in one process and compared
against identical triggers. The result decides the design:

| Trigger | `CM_Register_Notification` | `DBT_DEVTYP_VOLUME` broadcast |
| --- | --- | --- |
| ISO mount / dismount | fires (`\\?\SCSI#CdRom&Ven_Msft&Prod_Virtual_DVD-ROM…`) | fires, `units=D` |
| `subst X: …` / `subst /d` | **silent** | fires, `units=X`, `flags=DBTF_NET` |
| `net use Z: \\host\share` / `/delete` | **silent** | fires, `units=Z`, `flags=DBTF_NET` |

- Windows enumeration is `GetLogicalDriveStringsW`, which **includes** `subst`
  and `net use` letters. `CM_Register_Notification` therefore covers a strict
  subset of what this library reports, and cannot be the primary source.
- **The window must be top-level, not `HWND_MESSAGE`.** `DBT_DEVTYP_VOLUME` is
  a broadcast, and broadcasts are not delivered to message-only windows. Use
  `WS_EX_TOOLWINDOW | WS_POPUP`, zero-sized, and never call `ShowWindow` — it
  stays off the taskbar and out of Alt-Tab.
- No `RegisterDeviceNotification` call is needed. Volume broadcasts go to every
  top-level window; registration is only for *device interface* events, and
  registering for one just produced duplicate `DBT_DEVTYP_DEVICEINTERFACE`
  events alongside the volume ones.
- `dbcv_unitmask` gives the exact drive letters that changed, and `DBTF_NET`
  distinguishes DOS-device mappings from real volumes. The reconciler does not
  need this, but it is useful for debug logging.
- **This is the one platform that needs a thread**: there is no pollable
  descriptor, so it cannot ride `uv_poll_t`. A dedicated thread owns the window
  and a `GetMessageW` pump; `WM_DEVICECHANGE` hands off through a
  `napi_threadsafe_function`. Verified end to end from Node: 5/5 runs delivered
  both the `subst` add and the `subst /d` remove.
- **Unexplained miss, 1 run in 6.** The first run of that Node addon saw the
  arrival but not the removal; five subsequent identical runs all passed. The
  leading hypothesis is broadcast latency — the system sends these with a
  per-window `SendMessageTimeout` across every top-level window in the session,
  so an unresponsive third-party window delays delivery to everyone behind it,
  and that run stopped the watcher 1.7 s after the trigger. **Not confirmed.**
  It is a concrete reason the safety-net poll stays.
- Session 0 risk, **unverified**: a Node process running as a Windows service
  has a non-interactive window station and may not receive broadcasts.
  `CreateWindowExW` failing (or succeeding but never delivering) must degrade to
  poll-only, not throw. Registering `CM_Register_Notification` as a supplement
  is cheap and is window-station independent, so it still covers physical volume
  arrival in that environment.

### Integration

- `PollingWatcher` already has the right seam: `observe()` → `reconcile()`. Push
  only changes *when* `poll()` runs. Do not add a second code path that emits
  changes.
- The per-`napi_env` `ModuleInstanceData` in `src/common/shutdown.h` is where a
  watcher registry belongs. Worker threads each get their own env and their own
  loop, and `worker_threads.test.ts` exercises that.
- `uv_unref()` the poll handle (and `napi_unref_threadsafe_function` on Windows)
  so a subscription never holds the process open on its own. `PollingWatcher`
  already exposes `ref()`/`unref()`/`hasRef()` and those must keep working:
  today they act on the timer, and they will need to act on the push handle too.
- Linux currently has **no** native mount-point code — enumeration is
  `src/linux/mount_points.ts` in TypeScript. This adds the first Linux native
  file in that area. It cannot be done in pure JS: Node exposes no `epoll`, and
  `fs.watch` (inotify) does not work on procfs.

## Solutions

### Option A (preferred): push as a debounced hint into the existing timer

Add an optional native "dirty signal" source to `PollingWatcher`. On a signal,
cancel the pending timer and run `poll()` after a short trailing debounce; on
each settled poll, re-arm the timer as it does today.

- One code path produces changes, so every existing test stays meaningful.
- Degrades cleanly: if the native source cannot start on this platform, kernel,
  or window station, the watcher is exactly what ships today.
- The safety-net interval can be lengthened when a push source is healthy
  (that is a separate decision — it changes an existing default's meaning, so
  it should be opt-in, not silent).
- Cost: `PollingWatcher` gains a second wake source and needs its non-overlap
  invariant re-proven — a signal arriving mid-scan must coalesce into one
  follow-up scan, not queue N of them.

### Option B: separate push-only watcher API

A new `watchVolumeMountPointsNative()` alongside the polling one.

- Rejected. It doubles the public surface, forces callers to choose between
  latency and completeness, and duplicates the reconciler.

### Option C: replace polling with push

- Rejected. Each platform misses a class of change, Windows delivery is not
  guaranteed, and there is no recovery path from a missed notification.

## Tasks

- [ ] Add deterministic TypeScript tests for the dirty-signal path with an
      injected signal source: debounce coalescing, no overlap with an in-flight
      scan, signal during a scan queues exactly one follow-up, timer re-arms
      after a pushed scan, `close()`/abort during a pending debounce, and
      `ref`/`unref` covering both wake sources.
- [ ] Extend `PollingWatcher` with an optional signal source; keep the current
      behavior byte-for-byte when none is supplied.
- [ ] Linux native: `uv_poll_t` + `UV_PRIORITIZED` on `/proc/self/mounts`,
      per-env registry, `uv_unref`, drain-on-wake. Detect a non-pollable path
      and report unsupported rather than never firing.
- [ ] macOS native: `kqueue` + `EVFILT_FS`, `uv_poll_t` + `UV_READABLE` on the
      kqueue fd, filter to `VQ_MOUNT | VQ_UNMOUNT`, drain with zero timeout.
- [ ] Windows native: dedicated thread, top-level `WS_EX_TOOLWINDOW` window,
      `GetMessageW` pump, `DBT_DEVTYP_VOLUME` → `napi_threadsafe_function`.
      Clean teardown via `PostThreadMessageW(WM_QUIT)` + join. Degrade to
      poll-only if the window cannot be created.
- [ ] Decide and document whether the safety-net interval changes when push is
      active. Default to no change; make any lengthening opt-in.
- [ ] Add native resource checks: the watcher must survive
      `npm run check:memory` and `npm run check:tsan`. The Windows thread and
      the TSFN are new TSan/handle-leak surface, and Windows handle counts are
      already monitored by `windows-resource-security.test.ts`.
- [ ] Document per-platform coverage and the "hint, not audit log" contract in
      `doc/gotchas.md` and `doc/examples.md`.
- [ ] Cross-platform validation on `m1` and `swift` per the process in
      `_done/20260805-volume-mount-subscriptions.md`.

## Open questions

- Should push latency be exposed at all (e.g. a `pushLatencyMs` debounce
  option), or fixed internally? A fixed value is simpler and the burst
  measurement suggests something in the 50–250 ms range.
- Is the Windows 1-in-6 miss reproducible under load, and is the
  `SendMessageTimeout` hypothesis correct? Worth one targeted experiment with a
  deliberately hung top-level window before implementation.
- Does the broadcast reach a Node process in Session 0 (Windows service)? Needs
  a service install to answer; until then the code must not assume it does.
