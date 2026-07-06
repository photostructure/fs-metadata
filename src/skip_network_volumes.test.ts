// src/skip_network_volumes.test.ts
//
// skipNetworkVolumes must prevent every mount-point touch for remote volumes
// on Linux: no directoryStatus() readdir and no native call — the point of
// the option is to avoid blocking on unreachable NFS/SMB mounts.
//
// Uses a fake mount table naming a real (local) directory as an NFS mount,
// and a native-bindings factory that throws if the impl tries to load it.

import { jest } from "@jest/globals";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statAsync } from "./fs";
import { optionsWithDefaults } from "./options";
import { describePlatform } from "./test-utils/platform";
import type {
  GetVolumeMetadataOptions,
  NativeBindings,
} from "./types/native_bindings";
import type { Options } from "./types/options";
import type { VolumeMetadata } from "./types/volume_metadata";
import {
  findMountPointByDeviceId,
  getVolumeMetadataImpl,
} from "./volume_metadata";
import { getVolumeMountPointsImpl } from "./volume_mount_points";

describePlatform("linux")("skipNetworkVolumes (Linux)", () => {
  let dir: string;
  let mtabPath: string;

  const nativeFnThatThrows = () => {
    throw new Error(
      "native bindings must not be used for skipped network volumes",
    );
  };

  const mockGetVolumeMetadata = jest.fn(
    async (opts: GetVolumeMetadataOptions): Promise<VolumeMetadata> =>
      ({
        mountPoint: opts.mountPoint,
        size: 100,
        used: 50,
        available: 50,
      }) as VolumeMetadata,
  );
  const mockNativeFn = () =>
    ({ getVolumeMetadata: mockGetVolumeMetadata }) as unknown as NativeBindings;

  const opts = (
    overrides: Partial<GetVolumeMetadataOptions & Options>,
  ): GetVolumeMetadataOptions & Options =>
    optionsWithDefaults<GetVolumeMetadataOptions & Options>({
      mountPoint: dir,
      linuxMountTablePaths: [mtabPath],
      ...overrides,
    });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "fs-metadata-skip-net-"));
    mtabPath = join(dir, "mtab");
  });

  beforeEach(() => mockGetVolumeMetadata.mockClear());

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns shallow mount-table metadata for a remote volume without touching it", async () => {
    await writeFile(mtabPath, `nas:/export ${dir} nfs rw,relatime 0 0\n`);
    const result = await getVolumeMetadataImpl(
      opts({ skipNetworkVolumes: true }),
      nativeFnThatThrows,
    );
    expect(result.remote).toBe(true);
    expect(result.status).toBe("unknown");
    expect(result.fstype).toBe("nfs");
    expect(result.remoteHost).toBe("nas");
    expect(result.remoteShare).toBe("export");
    // Detailed (probed) fields must be absent — nothing touched the volume:
    expect(result.size).toBeUndefined();
    expect(result.uuid).toBeUndefined();
    expect(result.label).toBeUndefined();
  });

  it("still queries native for remote volumes when skipNetworkVolumes is false", async () => {
    await writeFile(mtabPath, `nas:/export ${dir} nfs rw,relatime 0 0\n`);
    const result = await getVolumeMetadataImpl(
      opts({ skipNetworkVolumes: false }),
      mockNativeFn,
    );
    expect(mockGetVolumeMetadata).toHaveBeenCalledTimes(1);
    expect(result.remote).toBe(true);
    expect(result.size).toBe(100);
  });

  it("still queries native for local volumes when skipNetworkVolumes is true", async () => {
    await writeFile(mtabPath, `/dev/sda1 ${dir} ext4 rw,relatime 0 0\n`);
    const result = await getVolumeMetadataImpl(
      opts({ skipNetworkVolumes: true }),
      mockNativeFn,
    );
    expect(mockGetVolumeMetadata).toHaveBeenCalledTimes(1);
    expect(result.remote).toBe(false);
    expect(result.size).toBe(100);
  });

  it("skips volumes that are remote by fstype alone (unparseable source)", async () => {
    // 9p's fs_spec ("svc" here) matches none of the remote-source patterns,
    // so remote-ness must come from the fstype
    await writeFile(mtabPath, `svc ${dir} 9p rw,relatime 0 0\n`);
    const result = await getVolumeMetadataImpl(
      opts({ skipNetworkVolumes: true }),
      nativeFnThatThrows,
    );
    expect(result.remote).toBe(true);
    expect(result.fstype).toBe("9p");
    expect(result.status).toBe("unknown");
    expect(result.size).toBeUndefined();
  });

  it("does not health-probe remote mount points during enumeration", async () => {
    // The NFS mount point deliberately doesn't exist: a directoryStatus()
    // probe would mark it inaccessible, so an undefined status proves the
    // probe was skipped.
    const missing = join(dir, "does-not-exist");
    await writeFile(
      mtabPath,
      `/dev/sda1 ${dir} ext4 rw,relatime 0 0\nnas:/export ${missing} nfs rw,relatime 0 0\n`,
    );

    const skipped = await getVolumeMountPointsImpl(
      opts({ skipNetworkVolumes: true, includeSystemVolumes: true }),
      nativeFnThatThrows,
    );
    const nfs = skipped.find((ea) => ea.mountPoint === missing);
    expect(nfs?.fstype).toBe("nfs");
    expect(nfs?.status).toBeUndefined();

    const probed = await getVolumeMountPointsImpl(
      opts({ skipNetworkVolumes: false, includeSystemVolumes: true }),
      nativeFnThatThrows,
    );
    const probedNfs = probed.find((ea) => ea.mountPoint === missing);
    expect(probedNfs?.status).toBeDefined();
    expect(probedNfs?.status).not.toBe("healthy");
  });

  it("does not stat non-ancestor remote mount points during path resolution", async () => {
    // "other" is a real local dir masquerading as an NFS mount. It shares
    // the target's device id, so without the skip it wins the device-only
    // fallback; with the skip it must not even be statted, leaving no
    // candidates at all.
    const target = join(dir, "target");
    const other = join(dir, "other");
    await mkdir(target, { recursive: true });
    await mkdir(other, { recursive: true });
    await writeFile(mtabPath, `nas:/export ${other} nfs rw,relatime 0 0\n`);
    const targetStat = await statAsync(target);

    await expect(
      findMountPointByDeviceId(
        target,
        targetStat,
        opts({ skipNetworkVolumes: false }),
        nativeFnThatThrows,
      ),
    ).resolves.toBe(other);

    await expect(
      findMountPointByDeviceId(
        target,
        targetStat,
        opts({ skipNetworkVolumes: true }),
        nativeFnThatThrows,
      ),
    ).rejects.toThrow(/No mount point found/);
  });

  it("still stats ancestor remote mount points during path resolution", async () => {
    // Skipping ancestors would break resolution for paths on healthy
    // network mounts, so they are always statted.
    const target = join(dir, "target");
    await mkdir(target, { recursive: true });
    await writeFile(mtabPath, `nas:/export ${dir} nfs rw,relatime 0 0\n`);
    const targetStat = await statAsync(target);

    await expect(
      findMountPointByDeviceId(
        target,
        targetStat,
        opts({ skipNetworkVolumes: true }),
        nativeFnThatThrows,
      ),
    ).resolves.toBe(dir);
  });
});
