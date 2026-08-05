import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getVolumeMountPoints } from "../index";
import { describePlatform } from "../test-utils/platform";

describePlatform("linux")("GVfs bridge enumeration", () => {
  let tempDir: string;
  let bridge: string;
  let mountTable: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fs-metadata-gvfs-"));
    bridge = join(tempDir, ".gvfs");
    mountTable = join(tempDir, "mounts");
    await mkdir(bridge);
    await writeFile(
      mountTable,
      `gvfsd-fuse ${bridge} fuse.gvfsd-fuse rw,nosuid,nodev,user_id=1000 0 0\n`,
    );
  });

  afterAll(async () => {
    await rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 3 : 1,
      retryDelay: process.platform === "win32" ? 100 : 0,
    });
  });

  it("excludes the bridge by default", async () => {
    await expect(
      getVolumeMountPoints({ linuxMountTablePaths: [mountTable] }),
    ).resolves.toEqual([]);
  });

  it("restores the aggregate bridge when system volumes are included", async () => {
    const result = await getVolumeMountPoints({
      includeSystemVolumes: true,
      linuxMountTablePaths: [mountTable],
    });

    expect(result).toEqual([
      expect.objectContaining({
        mountPoint: bridge,
        fstype: "fuse.gvfsd-fuse",
        isSystemVolume: true,
        status: "healthy",
      }),
    ]);
  });
});
