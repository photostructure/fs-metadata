// src/__tests__/async-behavior.test.ts

import { randomInt } from "crypto";
import { times } from "../array.js";
import { delay, TimeoutError } from "../async.js";
import { defer } from "../defer.js";
import {
  ExcludedMountPointGlobsDefault,
  getVolumeMetadata,
  getVolumeMountPoints,
  TimeoutMsDefault,
} from "../index.js";
import { omit } from "../object.js";
import { isWindows } from "../platform.js";
import { pickRandom, randomChar, shuffle } from "../random.js";

process.env.UV_THREADPOOL_SIZE = "8";

describe("Filesystem API Async Behavior", () => {
  const opts = {
    timeoutMs: TimeoutMsDefault * 2,
    excludedMountPointGlobs: [...ExcludedMountPointGlobsDefault, "**/wsl*/**"],
  };
  const deferredMountPoints = defer(() => getVolumeMountPoints(opts));

  // Test concurrent operations
  describe("Concurrent Operations", () => {
    jest.setTimeout(4 * TimeoutMsDefault);

    it("should handle multiple concurrent getVolumeMountPoints()", async () => {
      const expected = await deferredMountPoints();
      for (const ea of await Promise.all(
        times(8, () => getVolumeMountPoints(opts)),
      )) {
        expect(ea).toEqual(expected);
      }
    });

    it("should handle concurrent getVolumeMetadata() calls", async () => {
      const mountPoints = await deferredMountPoints();
      const expectedMountPoint = mountPoints[0];
      const expected = await getVolumeMetadata(expectedMountPoint);

      // interleaved calls to getVolumeMetadata to expose intra-thread data
      // leaks: if the metadata is not consistent, then the implementation is
      // not thread-safe.
      const inputs = shuffle([
        ...times(2, () => expectedMountPoint),
        ...times(
          2,
          () =>
            isWindows
              ? randomChar() + ":\\"
              : pickRandom(["/mnt", "/media", "/run", "/nonexistent"]), // /tmp made it flaky on wsl, /var was flaky on GHA ubuntu
        ),
        ...times(2, () => pickRandom(mountPoints)),
      ]);

      const arr = await Promise.all(
        inputs.map(async (ea) => {
          await delay(randomInt(0, 10));
          try {
            return await getVolumeMetadata(ea, {
              timeoutMs: TimeoutMsDefault * 2,
            });
          } catch (err: any) {
            if (ea === expectedMountPoint) {
              // we don't expect an error from the expected mount point! Those
              // should fail the test!
              throw err;
            } else return err;
          }
        }),
      );

      for (const ea of arr) {
        if (ea instanceof Error) {
          expect(ea.message).toMatch(/not accessible/i);
        } else if (ea.mountPoint === expectedMountPoint) {
          // it's true that some metadata (like free space) can change between
          // calls. We don't expect it, but by omitting these fields, we don't
          // have to resort to retrying the test (which can hide actual bugs,
          // especially from multithreading).
          expect(omit(ea, "available", "used")).toEqual(
            omit(expected, "available", "used"),
          );
        }
      }
    });
  });

  describe("Timeouts", () => {
    it("getVolumeMountPoints() should reject with timeoutMs=1", async () => {
      await expect(getVolumeMountPoints({ timeoutMs: 1 })).rejects.toThrow(
        TimeoutError,
      );
    });
    it("getVolumeMetadata() should reject with timeoutMs=1", async () => {
      const root = isWindows ? "C:\\" : "/";
      await expect(getVolumeMetadata(root, { timeoutMs: 1 })).rejects.toThrow(
        TimeoutError,
      );
    });
  });
});
