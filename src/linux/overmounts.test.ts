// src/linux/overmounts.test.ts

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getAllVolumeMetadata,
  getVolumeMetadata,
  getVolumeMountPoints,
} from "../index";
import { isLinux } from "../platform";
import { getLinuxMountPoints, getLinuxMtabMetadata } from "./mount_points";

const describeLinux = isLinux ? describe : describe.skip;

/**
 * A systemd direct automount (`x-systemd.automount`, or a `.automount` unit)
 * keeps its `autofs` trigger entry in the mount table and mounts the real
 * filesystem *over* it once the path is touched. Both entries share a mount
 * point, and the autofs one comes first.
 *
 * Taking the first match reports `fstype: "autofs"` / `mountFrom: "systemd-1"`,
 * which has no device — so blkid and /dev/disk/by-uuid have nothing to resolve
 * and `uuid`/`label` come back empty, while `size`/`used` (which come from
 * statvfs on the path) describe the real filesystem. The overmount is listed
 * after the trigger it hides, so the last entry is the one metadata must
 * describe. See `lastMountEntriesByPath()` for the limits of that rule.
 */
describeLinux("Linux overmounted mount points", () => {
  let tempDir: string;
  let btrfsMount: string;
  let ext4Mount: string;
  let mountTable: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fs-metadata-overmount-"));
    btrfsMount = join(tempDir, "12tb");
    ext4Mount = join(tempDir, "sata");
    mountTable = join(tempDir, "mounts");

    await mkdir(btrfsMount);
    await mkdir(ext4Mount);
    await writeFile(
      mountTable,
      [
        `systemd-1 ${btrfsMount} autofs rw,relatime,fd=71,pgrp=1,timeout=0,direct 0 0`,
        `systemd-1 ${ext4Mount} autofs rw,relatime,fd=82,pgrp=1,timeout=0,direct 0 0`,
        `/dev/sda1 ${btrfsMount} btrfs rw,relatime,space_cache=v2,subvolid=5,subvol=/ 0 0`,
        `/dev/sdb ${ext4Mount} ext4 rw,relatime 0 0`,
      ].join("\n"),
    );
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("getLinuxMountPoints() reports one entry per mount point, describing the overmount", async () => {
    const mountPoints = await getLinuxMountPoints({
      linuxMountTablePaths: [mountTable],
    });

    expect(mountPoints).toEqual([
      {
        mountPoint: btrfsMount,
        fstype: "btrfs",
        isReadOnly: false,
        subvol: "/",
        subvolid: 5,
      },
      { mountPoint: ext4Mount, fstype: "ext4", isReadOnly: false },
    ]);
  });

  it("getLinuxMtabMetadata() returns the overmount, not the autofs trigger", async () => {
    const entry = await getLinuxMtabMetadata(btrfsMount, {
      linuxMountTablePaths: [mountTable],
    });

    expect(entry).toEqual(
      expect.objectContaining({
        fs_file: btrfsMount,
        fs_spec: "/dev/sda1",
        fs_vfstype: "btrfs",
      }),
    );
  });

  it("does not classify an automounted volume as a system volume", async () => {
    const mountPoints = await getVolumeMountPoints({
      includeSystemVolumes: true,
      linuxMountTablePaths: [mountTable],
    });

    expect(mountPoints.map((ea) => ea.isSystemVolume)).toEqual([false, false]);

    // ...so they survive the default (system-volume-excluding) enumeration:
    const visible = await getVolumeMountPoints({
      linuxMountTablePaths: [mountTable],
    });
    expect(visible.map((ea) => ea.mountPoint).sort()).toEqual(
      [btrfsMount, ext4Mount].sort(),
    );
  });

  it("getVolumeMetadata() reports the real device and fstype", async () => {
    const metadata = await getVolumeMetadata(btrfsMount, {
      linuxMountTablePaths: [mountTable],
    });

    expect(metadata).toEqual(
      expect.objectContaining({
        mountPoint: btrfsMount,
        mountFrom: "/dev/sda1",
        fstype: "btrfs",
        subvol: "/",
        subvolid: 5,
        status: "healthy",
      }),
    );
    expect(metadata.isSystemVolume).toBe(false);
  });

  it("getAllVolumeMetadata() does not emit duplicates for a shadowed mount point", async () => {
    const metadata = await getAllVolumeMetadata({
      includeSystemVolumes: true,
      linuxMountTablePaths: [mountTable],
    });

    expect(metadata.map((ea) => ea.mountPoint).sort()).toEqual(
      [btrfsMount, ext4Mount].sort(),
    );
    expect(metadata.map((ea) => ea.fstype).sort()).toEqual(["btrfs", "ext4"]);
  });
});
