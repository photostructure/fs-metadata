// src/options.ts

import { availableParallelism } from "node:os";
import { env } from "node:process";
import { compactValues, isObject } from "./object";
import { isWindows } from "./platform";
import type { Options } from "./types/options";

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

  // macOS system paths:
  "/private/var/vm", // macOS swap
  "/System/Volumes/Hardware",
  "/System/Volumes/iSCPreboot",
  "/System/Volumes/Preboot",
  "/System/Volumes/Recovery",
  "/System/Volumes/Reserved",
  "/System/Volumes/Update",
  "/System/Volumes/VM",
  "/System/Volumes/xarts",

  // macOS per-volume metadata (Spotlight, FSEvents, versioning, Trash):
  // https://eclecticlight.co/2021/01/28/spotlight-on-search-how-spotlight-works/
  "**/.DocumentRevisions-V100",
  "**/.fseventsd",
  "**/.Spotlight-V100",
  "**/.Trashes",
] as const;

/**
 * Filesystem types that indicate system/virtual volumes.
 *
 * These are pseudo-filesystems that don't represent real storage devices.
 * See /proc/filesystems for the full list supported by the running kernel.
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
  "fuse.snapfuse",
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
  "snap*",
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
 * Default {@link Options} object.
 *
 * @see {@link optionsWithDefaults} for creating an options object with default values
 */
export const OptionsDefault: Options = {
  timeoutMs: getTimeoutMsDefault(),
  maxConcurrency: availableParallelism(),
  systemPathPatterns: [...SystemPathPatternsDefault],
  systemFsTypes: [...SystemFsTypesDefault],
  linuxMountTablePaths: [...LinuxMountTablePathsDefault],
  networkFsTypes: [...NetworkFsTypesDefault],
  includeSystemVolumes: IncludeSystemVolumesDefault,
  skipNetworkVolumes: SkipNetworkVolumesDefault,
} as const;

/**
 * Create an {@link Options} object using default values from
 * {@link OptionsDefault} for missing fields.
 */
export function optionsWithDefaults<T extends Options>(
  overrides: Partial<T> = {},
): T {
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
  };
}
