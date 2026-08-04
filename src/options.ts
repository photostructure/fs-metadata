// src/options.ts

import { availableParallelism } from "node:os";
import { env } from "node:process";
import { compactValues, isObject } from "./object";
import { isWindows } from "./platform";
import type { Options, ResolvedOptions } from "./types/options";

const DefaultTimeoutMs = 5_000;

/**
 * Get the default timeout in milliseconds for {@link Options.timeoutMs}.
 *
 * This can be overridden by setting the `FS_METADATA_TIMEOUT_MS` environment
 * variable to a positive integer.
 *
 * Note that this timeout may be insufficient for some devices, like spun-down
 * optical drives or network shares that need to spin up or reconnect.
 *
 * @returns The timeout from env var if valid, otherwise 5000ms
 */
export function getTimeoutMsDefault(): number {
  const value = env["FS_METADATA_TIMEOUT_MS"];
  if (value == null) return DefaultTimeoutMs;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DefaultTimeoutMs;
}

/**
 * libuv's thread pool size when `UV_THREADPOOL_SIZE` is unset.
 *
 * @see https://docs.libuv.org/en/v1.x/threadpool.html
 */
const DefaultUvThreadpoolSize = 4;

/**
 * Extra in-flight requests allowed beyond the libuv thread pool size. See
 * {@link getMaxConcurrencyDefault}.
 *
 * Holding exactly one request per thread lets threads idle during this
 * library's event-loop turnaround between completions. A couple of already-
 * queued requests covers that gap, and the gap is a fixed cost — it does not
 * grow with the pool — so this is additive rather than a multiplier.
 *
 * Measured on a 32-core box (4-thread pool) enumerating 57 volumes: concurrency
 * 1 took ~57ms, 2 ~37ms, 4 ~29ms, 6 ~31ms, 8 ~25ms, 16 ~22ms, 32 ~21ms. Past
 * the pool size the curve is nearly flat — single-digit milliseconds separate 6
 * from 32, and 6/7/8 are indistinguishable from noise — so the remaining
 * headroom is not worth the queue depth it costs the host application.
 */
const UvThreadpoolHeadroom = 3;

/**
 * Get the default value for {@link Options.maxConcurrency}.
 *
 * Every filesystem call this library makes — `stat()`, `readdir()`, and the
 * native metadata workers — runs on libuv's thread pool, **not** on one thread
 * per core. That pool holds `UV_THREADPOOL_SIZE` threads (4 unless the embedder
 * raised it, regardless of core count), it is shared with the rest of the
 * process, and its queue is FIFO.
 *
 * So core count is the wrong unit for this limit: on a 128-core machine
 * `availableParallelism()` would enqueue 128 requests against those same 4
 * threads, and any unrelated read the host application issues waits behind the
 * whole backlog. Scaling with the pool instead keeps queue depth bounded no
 * matter how large the machine is.
 *
 * Set `UV_THREADPOOL_SIZE` in the environment **before Node starts** to raise
 * both the pool and this default. Assigning `process.env` at runtime happens to
 * work while the pool is still uncreated, but Node does not guarantee it
 * affects an already-created pool.
 *
 * @returns the pool-aware concurrency limit, at least 1
 * @see https://nodejs.org/api/cli.html#uv_threadpool_sizesize
 */
export function getMaxConcurrencyDefault(): number {
  return Math.max(
    1,
    Math.min(availableParallelism(), uvThreadpoolSize() + UvThreadpoolHeadroom),
  );
}

/**
 * libuv's hard ceiling on the thread pool.
 *
 * @see https://docs.libuv.org/en/v1.x/threadpool.html
 */
const MaxUvThreadpoolSize = 1024;

/**
 * Longest `UV_THREADPOOL_SIZE` value libuv can actually read.
 *
 * libuv fetches the variable into a fixed 16-byte buffer, so a value needing 16
 * or more bytes (including the terminator) makes the read fail and the pool
 * stays at {@link DefaultUvThreadpoolSize} — the value is ignored entirely
 * rather than parsed.
 */
const MaxUvThreadpoolSizeValueBytes = 15;

/**
 * The pool size libuv will actually use for the current environment.
 *
 * This deliberately mirrors libuv's own handling rather than validating the
 * value, because guessing wrong makes the concurrency limit describe a pool
 * that does not exist. libuv reads the variable into a fixed 16-byte buffer,
 * runs the result through `atoi()` — which yields `0` for empty and
 * non-numeric input — assigns it to an *unsigned* field, then clamps: `0`
 * becomes 1, and anything above the ceiling (including a negative that wrapped
 * around) becomes {@link MaxUvThreadpoolSize}.
 *
 * Verified against Node 24 by timing concurrent `pbkdf2` calls: unset yields 4
 * threads, `"0"` and `"banana"` yield 1, `"-3"` yields the 1024 ceiling, a
 * 15-byte `"000000000000001"` yields 1, and a 16-byte `"0000000000000001"`
 * falls back to 4 because the read itself fails.
 */
export function uvThreadpoolSize(): number {
  const value = env["UV_THREADPOOL_SIZE"];
  if (value == null) return DefaultUvThreadpoolSize;
  // Too long for libuv's buffer: it never sees the value, so neither do we.
  if (Buffer.byteLength(value, "utf8") > MaxUvThreadpoolSizeValueBytes) {
    return DefaultUvThreadpoolSize;
  }
  // parseInt() stops at the first non-digit like atoi(); NaN stands in for
  // atoi()'s 0 on wholly non-numeric input.
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed === 0) return 1;
  // Negative values wrap through libuv's unsigned field into the ceiling.
  return parsed < 0 || parsed > MaxUvThreadpoolSize
    ? MaxUvThreadpoolSize
    : parsed;
}

/**
 * System paths and globs that indicate system volumes
 */
export const SystemPathPatternsDefault = [
  "/boot",
  "/boot/efi",
  "/dev",
  "/dev/**",
  "/proc/**",
  "/run",
  "/run/credentials/**",
  "/run/flatpak/**",
  "/run/lock",
  "/run/snapd/**",
  "/run/user/*/doc",
  "/run/user/*/gvfs",
  "/snap/**",
  // snapd's AltSnapMountDir, used wherever /snap is absent or is a symlink to
  // it (Fedora, openSUSE). Mount entries report the resolved path, so /snap/**
  // does not cover these.
  // https://github.com/canonical/snapd/blob/master/dirs/dirs.go
  "/var/lib/snapd/snap/**",
  "/sys/**",
  "/tmp",
  "/var/tmp",
  // we aren't including /tmp/**, as some people temporarily mount volumes there, like /tmp/project.
  "**/#snapshot", // Synology and Kubernetes volume snapshots

  // Container runtime paths - these are internal infrastructure paths that are
  // inaccessible to non-root processes and should never be scanned.
  //
  // Docker: https://docs.docker.com/engine/storage/drivers/overlayfs-driver/
  // - /var/lib/docker contains overlay2 filesystems, container layers, images
  // - /run/docker contains runtime data like network namespaces
  "/run/docker/**",
  "/var/lib/docker/**",
  //
  // containerd: https://github.com/containerd/containerd/blob/main/docs/ops.md
  // - Used by Kubernetes, Docker (as backend), and standalone
  "/run/containerd/**",
  "/var/lib/containerd/**",
  //
  // Podman/CRI-O: https://podman.io/docs/installation#storage
  // - Rootless and rootful container storage
  "/run/containers/**",
  "/var/lib/containers/**",
  //
  // Kubernetes: https://kubernetes.io/docs/reference/node/kubelet-files/
  // - kubelet stores pod data, device plugins, and seccomp profiles
  "/var/lib/kubelet/**",
  //
  // LXC/LXD: https://linuxcontainers.org/
  // - Linux container storage and configuration
  "/var/lib/lxc/**",
  "/var/lib/lxd/**",

  // WSL (Windows Subsystem for Linux):
  "/mnt/wslg/distro",
  "/mnt/wslg/doc",
  "/mnt/wslg/versions.txt",
  "/usr/lib/wsl/drivers",

  // macOS system volumes are detected natively via APFS volume roles
  // (IOKit IOMedia "Role" property) with MNT_SNAPSHOT as a fallback.
  // No path patterns needed. See src/darwin/system_volume.h.
  //
  // /private/var/vm is the macOS swap directory (not a mount point on most
  // systems, but included for completeness if it appears as one).
  "/private/var/vm",
] as const;

/**
 * Filesystem types that indicate system/virtual volumes.
 *
 * These are pseudo-filesystems that don't represent real storage devices.
 * See /proc/filesystems for the full list supported by the running kernel.
 *
 * Entries are matched **exactly** by `isSystemVolume()` — this list is not
 * glob-compiled the way {@link SystemPathPatternsDefault} is, so every fstype
 * (including each `fuse.` subtype) must be spelled out in full.
 *
 * @see https://www.kernel.org/doc/html/latest/filesystems/ - Linux kernel filesystem docs
 * @see https://man7.org/linux/man-pages/man5/proc_filesystems.5.html - /proc/filesystems
 */
export const SystemFsTypesDefault = [
  "autofs",
  "binfmt_misc",
  // BPF filesystem for persistent BPF objects
  // https://docs.kernel.org/bpf/
  "bpf",
  "cgroup",
  "cgroup2",
  "configfs",
  "debugfs",
  "devpts",
  "devtmpfs",
  "efivarfs",
  "fusectl",
  // LXC container filesystem virtualization
  // https://linuxcontainers.org/lxcfs/
  "fuse.lxcfs",
  // XDG Desktop Portal for Flatpak sandboxed app file access
  // https://flatpak.github.io/xdg-desktop-portal/
  "fuse.portal",
  // snapd mounts each snap with the kernel's squashfs driver, except inside a
  // container (per `systemd-detect-virt`) that has /dev/fuse and a helper
  // binary, where it uses FUSE instead — preferring `squashfuse` over
  // `snapfuse`. It never probes for kernel squashfs support, so a container on
  // a squashfs-capable kernel still gets FUSE. The fstype is `fuse.` plus
  // whichever helper it picked, so both subtypes occur in the wild.
  // https://github.com/canonical/snapd/blob/master/osutil/squashfs/fstype.go
  "fuse.snapfuse",
  "fuse.squashfuse",
  "hugetlbfs",
  "mqueue",
  "none",
  // Linux namespace filesystem (internal kernel use)
  // https://man7.org/linux/man-pages/man7/namespaces.7.html
  "nsfs",
  "proc",
  "pstore",
  // RAM-based filesystem (predecessor to tmpfs)
  // https://www.kernel.org/doc/html/latest/filesystems/ramfs-rootfs-initramfs.html
  "ramfs",
  "rootfs",
  // NFS RPC communication pipe filesystem
  // https://man7.org/linux/man-pages/man8/rpc.gssd.8.html
  "rpc_pipefs",
  "securityfs",
  // The kernel-driver case for snap mounts; see `fuse.snapfuse` /
  // `fuse.squashfuse` above for the FUSE fallbacks. A `"snap*"` entry used to
  // sit here and never matched anything: this list is compared exactly, and no
  // filesystem is named `snap`-anything.
  "squashfs",
  "sysfs",
  "tmpfs",
  // Kernel function tracing filesystem
  // https://www.kernel.org/doc/html/latest/trace/ftrace.html
  "tracefs",
] as const;

export const LinuxMountTablePathsDefault = [
  "/proc/self/mounts",
  "/proc/mounts",
  "/etc/mtab",
] as const;

/**
 * Network/remote filesystem types.
 *
 * These filesystems require network connectivity and may have higher latency
 * or availability concerns. Used by {@link Options.networkFsTypes}.
 *
 * Based on systemd's fstype_is_network() and common FUSE remote filesystems.
 * @see https://github.com/systemd/systemd/blob/main/src/basic/mountpoint-util.c - fstype_is_network()
 */
export const NetworkFsTypesDefault = [
  // Plan 9 filesystem (VM host-guest, also network)
  // https://www.kernel.org/doc/html/latest/filesystems/9p.html
  "9p",
  // Apple Filing Protocol (legacy macOS/netatalk)
  "afp",
  // Andrew File System (distributed) - not to be confused with Apple's APFS
  // https://www.openafs.org/
  "afs",
  // BeeGFS parallel filesystem (HPC)
  // https://www.beegfs.io/
  "beegfs",
  // Ceph distributed filesystem
  // https://docs.ceph.com/
  "ceph",
  // Windows/Samba shares (SMB/CIFS)
  // https://www.samba.org/
  "cifs",
  // FTP filesystem mount
  "ftp",
  // Generic FUSE (often remote, treated conservatively)
  "fuse",
  // rclone cloud storage mount (Google Drive, S3, etc.)
  // https://rclone.org/commands/rclone_mount/
  "fuse.rclone",
  // Amazon S3 FUSE mount
  // https://github.com/s3fs-fuse/s3fs-fuse
  "fuse.s3fs",
  // SSH filesystem
  // https://github.com/libfuse/sshfs
  "fuse.sshfs",
  // Red Hat Global File System (cluster)
  "gfs",
  "gfs2",
  // GlusterFS distributed filesystem
  // https://www.gluster.org/
  "glusterfs",
  // Lustre parallel filesystem (HPC)
  // https://www.lustre.org/
  "lustre",
  // Novell NetWare (legacy)
  "ncpfs",
  "ncp",
  // Network File System
  // https://man7.org/linux/man-pages/man5/nfs.5.html
  "nfs",
  "nfs4",
  // SMB filesystem
  "smb",
  "smbfs",
  // SSH filesystem (non-FUSE variant)
  "sshfs",
  // WebDAV filesystem
  // https://savannah.nongnu.org/projects/davfs2
  "webdav",
] as const;

/**
 * Should {@link getAllVolumeMetadata} include system volumes by
 * default?
 */
export const IncludeSystemVolumesDefault = isWindows;

/**
 * Default value for {@link Options.skipNetworkVolumes}.
 */
export const SkipNetworkVolumesDefault = false;

/**
 * Default value for {@link Options.includeZfsGuids}. The authoritative ZFS
 * GUID path uses external commands, so it is deliberately opt-in.
 */
export const IncludeZfsGuidsDefault = false;

/**
 * Default {@link Options} object.
 *
 * @see {@link optionsWithDefaults} for creating an options object with default values
 */
export const OptionsDefault: ResolvedOptions = {
  timeoutMs: getTimeoutMsDefault(),
  maxConcurrency: getMaxConcurrencyDefault(),
  systemPathPatterns: [...SystemPathPatternsDefault],
  systemFsTypes: [...SystemFsTypesDefault],
  linuxMountTablePaths: [...LinuxMountTablePathsDefault],
  networkFsTypes: [...NetworkFsTypesDefault],
  includeSystemVolumes: IncludeSystemVolumesDefault,
  skipNetworkVolumes: SkipNetworkVolumesDefault,
  includeZfsGuids: IncludeZfsGuidsDefault,
} as const;

/**
 * Create an {@link Options} object using default values from
 * {@link OptionsDefault} for missing fields.
 */
export function optionsWithDefaults<T extends Options>(
  overrides: Partial<T> = {},
): T & ResolvedOptions {
  if (!isObject(overrides)) {
    throw new TypeError(
      "options(): expected an object, got " +
        typeof overrides +
        ": " +
        JSON.stringify(overrides),
    );
  }

  return {
    ...OptionsDefault,
    ...(compactValues(overrides) as T),
  } as T & ResolvedOptions;
}
