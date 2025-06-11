// src/linux/dev_disk.test.ts

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describePlatform } from "../test-utils/platform";
import { getBasenameLinkedTo } from "./dev_disk";

/*
Rather than fooling around with mocks, we're going to create a temporary
directory structure that mimics the real /dev/disk/by-uuid and
/dev/disk/by-label directories. We'll create some device files and symlinks to
test the getBasenameLinkedTo function.

- Create base temp directory: $tmp = /tmp/test-dev-disk
  - Create subdirectories: $tmp/dev/disk/by-uuid and /dev/disk/by-label
  - Create some device files: $tmp/dev/sda1, /dev/sda2
  - Create symlinks in by-uuid and by-label directories that match relative
    paths in /dev/disk/by-*:
    
    - by-uuid/ABC-DEF -> ../../sda2
    - by-uuid/123-456 -> ../../sda1
    - by-label/ROOT -> ../../sda1
    - by-label/DATA -> ../../sda2
*/

describePlatform("linux")("dev_disk", () => {
  let tempDir: string;
  let devDir: string;
  let byUuidDir: string;
  let byLabelDir: string;

  beforeAll(async () => {
    // Create base temp directory
    tempDir = await mkdtemp(join(tmpdir(), "test-dev-disk-"));

    // Create directory structure
    devDir = join(tempDir, "dev");
    byUuidDir = join(devDir, "disk", "by-uuid");
    byLabelDir = join(devDir, "disk", "by-label");

    await mkdir(devDir, { recursive: true });
    await mkdir(byUuidDir, { recursive: true });
    await mkdir(byLabelDir, { recursive: true });

    // Create some device files
    for (const device of ["sda1", "sda2"]) {
      const devicePath = join(devDir, device);
      await writeFile(devicePath, "# " + devicePath);
    }

    // Create symlinks
    await symlink("../../sda1", join(byUuidDir, "123-456"));
    await symlink("../../sda2", join(byUuidDir, "789-ABC"));
    await symlink("../../sda1", join(byLabelDir, "ROOT"));
    await symlink("../../sda2", join(byLabelDir, "1tb\\x20\\x28test\\x29"));
    // Create a broken symlink
    await symlink("../../sdX1", join(byUuidDir, "BAD-LINK"));
  });

  afterAll(async () => {
    // Use Windows-compatible cleanup pattern
    await rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 3 : 1,
      retryDelay: process.platform === "win32" ? 100 : 0,
    });
  });

  it("should find UUID for existing device", async () => {
    const result = await getBasenameLinkedTo(byUuidDir, join(devDir, "sda1"));
    expect(result).toBe("123-456");
  });

  it("should find label for existing device", async () => {
    const result = await getBasenameLinkedTo(byLabelDir, join(devDir, "sda2"));
    expect(result).toBe("1tb (test)");
  });

  it("should return undefined for non-existent device", async () => {
    const result = await getBasenameLinkedTo(byUuidDir, join(devDir, "sdz9"));
    expect(result).toBeUndefined();
  });

  it("should handle empty directory", async () => {
    const emptyDir = join(devDir, "empty");
    await mkdir(emptyDir);
    const result = await getBasenameLinkedTo(emptyDir, join(devDir, "sda1"));
    expect(result).toBeUndefined();
  });
});
