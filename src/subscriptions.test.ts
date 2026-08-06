import { jest } from "@jest/globals";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PollIntervalMsDefault,
  watchAvailableSpace,
  watchVolumeMountPoints,
} from "./index";
import { describePlatform } from "./test-utils/platform";
import { MinuteMs } from "./units";

describe("filesystem subscriptions", () => {
  it("uses a one-minute default polling interval", () => {
    expect(PollIntervalMsDefault).toBe(MinuteMs);
  });

  it("establishes a mount-point baseline through the public API", async () => {
    const watcher = watchVolumeMountPoints({
      includeSystemVolumes: true,
      persistent: false,
    });
    try {
      const baseline = await watcher.ready;
      expect(Array.isArray(baseline)).toBe(true);
      expect(baseline.length).toBeGreaterThan(0);
      expect(baseline[0]).toEqual(
        expect.objectContaining({ mountPoint: expect.any(String) }),
      );
    } finally {
      watcher.close();
    }
  });

  it("establishes an available-space predicate through the public API", async () => {
    const watcher = watchAvailableSpace(process.cwd(), {
      minimumAvailableBytes: 0,
      persistent: false,
    });
    try {
      const status = await watcher.ready;
      expect(status.path).toBe(process.cwd());
      expect(typeof status.availableBytes).toBe("number");
      expect(status.state).toBe("aboveMinimum");
    } finally {
      watcher.close();
    }
  });
});

describePlatform("linux")("Linux mount subscription compatibility", () => {
  it("omits file bind targets while reporting a newly seen directory target", async () => {
    jest.useFakeTimers();
    const tempDir = await mkdtemp(join(tmpdir(), "fs-metadata-watch-"));
    const fileTarget = join(tempDir, "file-target");
    const directoryTarget = join(tempDir, "directory-target");
    const mountTable = join(tempDir, "mounts");
    await writeFile(fileTarget, "target");
    await mkdir(directoryTarget);
    await writeFile(
      mountTable,
      `none / ext4 rw 0 0\nnone ${fileTarget} ext4 rw,bind 0 0\n`,
    );

    const changeResolvers: Array<(change: unknown) => void> = [];
    const nextChange = (): Promise<unknown> =>
      new Promise((resolve) => changeResolvers.push(resolve));
    const listener = jest.fn((change: unknown) => {
      changeResolvers.shift()?.(change);
    });
    const watcher = watchVolumeMountPoints(
      {
        includeSystemVolumes: true,
        linuxMountTablePaths: [mountTable],
        pollIntervalMs: 10,
        persistent: false,
      },
      listener,
    );
    try {
      const baseline = await watcher.ready;
      expect(baseline.map((point) => point.mountPoint)).toEqual(["/"]);

      await writeFile(
        mountTable,
        `none / ext4 rw 0 0\nnone ${fileTarget} ext4 rw,bind 0 0\nnone ${directoryTarget} ext4 rw,bind 0 0\n`,
      );
      const addedDirectory = nextChange();
      await jest.advanceTimersByTimeAsync(10);
      const change = await addedDirectory;

      expect(listener).toHaveBeenCalledTimes(1);
      expect(change).toEqual({
        generation: 1,
        added: [expect.objectContaining({ mountPoint: directoryTarget })],
        removed: [],
      });

      await writeFile(mountTable, `none / ext4 rw 0 0\n`);
      const removedDirectory = nextChange();
      await jest.advanceTimersByTimeAsync(10);
      await expect(removedDirectory).resolves.toMatchObject({
        removed: [expect.objectContaining({ mountPoint: directoryTarget })],
      });

      await rm(fileTarget);
      await mkdir(fileTarget);
      await writeFile(
        mountTable,
        `none / ext4 rw 0 0\nnone ${fileTarget} ext4 rw,bind 0 0\n`,
      );
      const readdedAsDirectory = nextChange();
      await jest.advanceTimersByTimeAsync(10);
      await expect(readdedAsDirectory).resolves.toMatchObject({
        added: [expect.objectContaining({ mountPoint: fileTarget })],
      });
    } finally {
      watcher.close();
      jest.useRealTimers();
      await rm(tempDir, {
        recursive: true,
        force: true,
        maxRetries: 1,
      });
    }
  });
});
