import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getAllVolumeMetadata,
  getMountPointForPath,
  getVolumeMetadata,
  getVolumeMetadataForPath,
  getVolumeMountPoints,
} from "../index";
import { isLinux } from "../platform";

const describeLinux = isLinux ? describe : describe.skip;

describeLinux("Linux file bind mounts", () => {
  let tempDir: string;
  let directoryMount: string;
  let fileMount: string;
  let ordinaryFile: string;
  let mountTable: string;
  let remoteMountTable: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fs-metadata-file-mount-"));
    directoryMount = join(tempDir, "volume");
    fileMount = join(directoryMount, "mounted-file");
    ordinaryFile = join(directoryMount, "ordinary-file");
    mountTable = join(tempDir, "mounts");
    remoteMountTable = join(tempDir, "remote-mounts");

    await mkdir(directoryMount);
    await writeFile(fileMount, "mounted file fixture");
    await writeFile(ordinaryFile, "ordinary file fixture");
    await writeFile(
      mountTable,
      [
        `test-device ${directoryMount} ext4 rw 0 0`,
        `test-device ${fileMount} ext4 rw 0 0`,
      ].join("\n"),
    );
    await writeFile(remoteMountTable, `server:/share ${fileMount} nfs rw 0 0`);
  });

  afterAll(async () => {
    await rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 3 : 1,
      retryDelay: process.platform === "win32" ? 100 : 0,
    });
  });

  it("omits non-directory targets from public volume enumeration", async () => {
    const options = {
      includeSystemVolumes: true,
      linuxMountTablePaths: [mountTable],
    };
    const mountPoints = await getVolumeMountPoints(options);

    expect(mountPoints.map(({ mountPoint }) => mountPoint)).toEqual([
      directoryMount,
    ]);
    expect(mountPoints[0]?.status).toBe("healthy");

    const metadata = await getAllVolumeMetadata(options);
    expect(metadata.map(({ mountPoint }) => mountPoint)).toEqual([
      directoryMount,
    ]);
  });

  it("resolves an exact non-directory mount without exposing it publicly", async () => {
    await expect(
      getMountPointForPath(fileMount, {
        linuxMountTablePaths: [mountTable],
      }),
    ).resolves.toBe(fileMount);

    const metadata = await getVolumeMetadataForPath(fileMount, {
      linuxMountTablePaths: [mountTable],
    });
    expect(metadata).toEqual(
      expect.objectContaining({
        mountPoint: fileMount,
        mountFrom: "test-device",
        fstype: "ext4",
        status: "healthy",
      }),
    );
    expect(typeof metadata.available).toBe("number");
    expect(typeof metadata.used).toBe("number");
  });

  it("accepts an exact non-directory mount in getVolumeMetadata", async () => {
    const metadata = await getVolumeMetadata(fileMount, {
      linuxMountTablePaths: [mountTable],
    });

    expect(metadata.mountPoint).toBe(fileMount);
    expect(metadata.status).toBe("healthy");
    expect(typeof metadata.size).toBe("number");
  });

  it("does not make getVolumeMetadata accept arbitrary files", async () => {
    await expect(
      getVolumeMetadata(ordinaryFile, {
        linuxMountTablePaths: [mountTable],
      }),
    ).rejects.toThrow();
  });

  it("retains unclassified remote targets when network probes are skipped", async () => {
    const options = {
      includeSystemVolumes: true,
      linuxMountTablePaths: [remoteMountTable],
      skipNetworkVolumes: true,
    };

    const mountPoints = await getVolumeMountPoints(options);
    expect(mountPoints).toEqual([
      expect.objectContaining({ mountPoint: fileMount, fstype: "nfs" }),
    ]);

    const metadata = await getAllVolumeMetadata(options);
    expect(metadata).toEqual([
      expect.objectContaining({
        mountPoint: fileMount,
        fstype: "nfs",
        remote: true,
        status: "unknown",
      }),
    ]);
  });
});
