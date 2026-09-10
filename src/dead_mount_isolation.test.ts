// src/dead_mount_isolation.test.ts

import type { Stats } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTimeout } from "./async";
import { type canReaddir, statAsync } from "./fs";
import { optionsWithDefaults } from "./options";
import { isLinux, isMacOS, isWindows } from "./platform";
import type { MountPoint } from "./types/mount_point";
import type { NativeBindingsFn } from "./types/native_bindings";
import type { Options } from "./types/options";
import {
  HealthProbeTimeoutDivisor,
  healthProbeTimeoutMs,
} from "./volume_health_status";
import { findMountPointByDeviceId } from "./volume_metadata";
import { getVolumeMountPointsImpl } from "./volume_mount_points";

/**
 * One unreachable mount point must not tax lookups for unrelated paths. A dead
 * `autofs` trigger, an unplugged `x-systemd.automount`, or a wedged FUSE mount
 * blocks `stat()` for seconds, and `fsp.stat()` cannot be cancelled — a
 * timeout abandons the promise but leaves the libuv thread parked. The only
 * remedy is to never issue the stat.
 */
describe("dead mount isolation", () => {
  const targetDev = 2049;
  const otherDev = 2050;

  function stats(dev: number): Stats {
    return { dev } as Stats;
  }

  /**
   * A `statAsync` stand-in that records what it was asked for, and never
   * settles for the named paths.
   */
  function trackingStat(opts: {
    devByPath: Record<string, number>;
    hangs?: string[];
  }) {
    const statted: string[] = [];
    const impl: typeof statAsync = (path) => {
      const p = String(path);
      statted.push(p);
      if (opts.hangs?.includes(p)) return new Promise<Stats>(() => {});
      const dev = opts.devByPath[p];
      return dev == null
        ? Promise.reject(new Error("ENOENT: " + p))
        : Promise.resolve(stats(dev));
    };
    return { statted, impl };
  }

  const nativeFn = (() => {
    throw new Error("native bindings must not be reached");
  }) as unknown as NativeBindingsFn;

  function mountPoints(...arr: (string | MountPoint)[]): MountPoint[] {
    return arr.map((ea) =>
      typeof ea === "string" ? { mountPoint: ea, fstype: "ext4" } : ea,
    );
  }

  function options(overrides: Partial<Options> = {}): Options {
    return optionsWithDefaults(overrides);
  }

  /**
   * Ancestry is decided with the platform's path separator, so POSIX literals
   * make every Windows assertion meaningless: `isAncestorOrSelf("/home", …)`
   * appends `\` and never matches, so the *intended ancestor* lands in the
   * fallback bucket instead. Phase one then finds nothing, phase two runs, and
   * the dead non-ancestor gets stat()ed after all — the exact outcome these
   * tests exist to rule out. The partitioning matters on both platforms, so
   * parameterize the fixtures rather than skipping the suite.
   */
  const p = isWindows
    ? {
        root: "C:\\",
        ancestor: "C:\\Users",
        target: "C:\\Users\\mrm\\photos\\img.jpg",
        shortTarget: "C:\\Users\\mrm\\x",
        dead: "Z:\\",
        unrelated: "D:\\",
        fallbackTarget: "C:\\Windows\\hosts",
        bindSource: "E:\\bind-source",
        deadRemote: "N:\\",
        unmatched: "C:\\Temp\\x",
      }
    : {
        root: "/",
        ancestor: "/home",
        target: "/home/mrm/photos/img.jpg",
        shortTarget: "/home/mrm/x",
        dead: "/mnt/Lexar",
        unrelated: "/proc",
        fallbackTarget: "/etc/hosts",
        bindSource: "/mnt/bind-source",
        deadRemote: "/mnt/dead-nfs",
        unmatched: "/tmp/x",
      };

  describe("findMountPointByDeviceId()", () => {
    it("never stats a non-ancestor when an ancestor already device-matches", async () => {
      const { statted, impl } = trackingStat({
        devByPath: { [p.root]: otherDev, [p.ancestor]: targetDev },
        hangs: [p.dead],
      });

      const result = await findMountPointByDeviceId(
        p.target,
        stats(targetDev),
        options({
          mountPoints: mountPoints(p.root, p.ancestor, p.dead, p.unrelated),
        }),
        nativeFn,
        impl,
      );

      expect(result).toBe(p.ancestor);
      // Only the two ancestors were touched. The dead mount was never stat-ed,
      // so it could not park a libuv thread.
      expect(statted.sort()).toEqual([p.root, p.ancestor]);
    });

    it("returns the longest ancestor when several share the device", async () => {
      const { impl } = trackingStat({
        devByPath: { [p.root]: targetDev, [p.ancestor]: targetDev },
      });

      await expect(
        findMountPointByDeviceId(
          p.shortTarget,
          stats(targetDev),
          options({ mountPoints: mountPoints(p.root, p.ancestor) }),
          nativeFn,
          impl,
        ),
      ).resolves.toBe(p.ancestor);
    });

    it("falls back to non-ancestors only when no ancestor device-matches", async () => {
      const { statted, impl } = trackingStat({
        devByPath: {
          [p.root]: otherDev,
          [p.bindSource]: targetDev,
        },
      });

      const result = await findMountPointByDeviceId(
        p.fallbackTarget,
        stats(targetDev),
        options({ mountPoints: mountPoints(p.root, p.bindSource) }),
        nativeFn,
        impl,
      );

      expect(result).toBe(p.bindSource);
      expect(statted.sort()).toEqual([p.root, p.bindSource]);
    });

    it("honors skipNetworkVolumes in the fallback phase", async () => {
      const { statted, impl } = trackingStat({
        devByPath: { [p.root]: otherDev },
        hangs: [p.deadRemote],
      });

      await expect(
        findMountPointByDeviceId(
          p.fallbackTarget,
          stats(targetDev),
          options({
            skipNetworkVolumes: true,
            mountPoints: mountPoints(p.root, {
              mountPoint: p.deadRemote,
              fstype: "nfs",
            }),
          }),
          nativeFn,
          impl,
        ),
      ).rejects.toThrow(/No mount point found/);

      expect(statted).toEqual([p.root]);
    });

    it("throws when nothing matches", async () => {
      const { impl } = trackingStat({ devByPath: { [p.root]: otherDev } });

      await expect(
        findMountPointByDeviceId(
          p.unmatched,
          stats(targetDev),
          options({ mountPoints: mountPoints(p.root) }),
          nativeFn,
          impl,
        ),
      ).rejects.toThrow(/No mount point found/);
    });

    it("ignores mount points whose stat() rejects", async () => {
      const { impl } = trackingStat({
        devByPath: { [p.ancestor]: targetDev }, // p.root rejects
      });

      await expect(
        findMountPointByDeviceId(
          p.shortTarget,
          stats(targetDev),
          options({ mountPoints: mountPoints(p.root, p.ancestor) }),
          nativeFn,
          impl,
        ),
      ).resolves.toBe(p.ancestor);
    });
  });

  // macOS-only: this asserts the budget handed to the *native* enumerator,
  // which only runs on the native platforms, and Windows deliberately keeps
  // the full value (no outer deadline there to lose a race to).
  (isMacOS ? describe : describe.skip)("native enumeration budget", () => {
    it("passes the whole macOS native deadline, including DA queue time", async () => {
      // Native now owns the operation deadline AND its shorter probe phase.
      const timeoutMs = 4_000;
      const received: (number | undefined)[] = [];
      const fakeNative = (() =>
        Promise.resolve({
          getVolumeMountPoints: (opts?: { timeoutMs?: number }) => {
            received.push(opts?.timeoutMs);
            return Promise.resolve([{ mountPoint: tmpdir() }]);
          },
        })) as unknown as NativeBindingsFn;

      await getVolumeMountPointsImpl(
        {
          ...optionsWithDefaults({ timeoutMs, includeSystemVolumes: true }),
          skipHealthProbes: true,
        },
        fakeNative,
      );

      expect(received).toEqual([timeoutMs]);
    });
  });

  // Linux-only: the fixture drives enumeration through the mount table.
  // macOS and Windows enumerate natively and cannot be given a fixture.
  (isLinux ? describe : describe.skip)("enumeration", () => {
    let tempDir: string;
    let liveDir: string;
    let deadDir: string;
    let mountTable: string;

    beforeAll(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "fs-metadata-dead-mount-"));
      liveDir = join(tempDir, "live");
      deadDir = join(tempDir, "dead");
      mountTable = join(tempDir, "mounts");
      await mkdir(liveDir);
      await mkdir(deadDir);
      await writeFile(
        mountTable,
        [
          `/dev/sda1 ${liveDir} ext4 rw 0 0`,
          `/dev/sdb1 ${deadDir} ext4 rw 0 0`,
        ].join("\n"),
      );
    });

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("resolves a path without health-probing any mount point", async () => {
      // Regression: supplying `mountPoints` bypasses enumeration, so a test
      // that injects them cannot see this. Without them, resolution builds the
      // list itself — and if that enumeration probes, one dead mount delays
      // EVERY lookup by the probe budget no matter how careful the stat()
      // partitioning is.
      const probed: string[] = [];
      const forbiddenReaddir: typeof canReaddir = (dir) => {
        probed.push(dir);
        throw new Error("must not health-probe during path resolution: " + dir);
      };

      const target = join(liveDir, "file.txt");
      await writeFile(target, "x");

      await expect(
        findMountPointByDeviceId(
          target,
          await statAsync(target),
          optionsWithDefaults({ linuxMountTablePaths: [mountTable] }),
          nativeFn,
          statAsync,
          forbiddenReaddir,
        ),
      ).resolves.toBe(liveDir);

      expect(probed).toEqual([]);
    });

    it("completes and marks the wedged mount point when one readdir() hangs", async () => {
      const timeoutMs = 2_000;
      // Mirrors the real canReaddir(): the caller's budget bounds the probe,
      // and a hang surfaces as a TimeoutError.
      const hangingReaddir: typeof canReaddir = (dir, probeMs) =>
        withTimeout({
          desc: "canReaddir()",
          promise:
            dir === deadDir
              ? new Promise<true>(() => {})
              : Promise.resolve(true as const),
          timeoutMs: probeMs,
        });

      const started = Date.now();
      const results = await getVolumeMountPointsImpl(
        {
          ...optionsWithDefaults({
            timeoutMs,
            includeSystemVolumes: true,
            linuxMountTablePaths: [mountTable],
          }),
          includeNonDirectoryMountPoints: true,
        },
        nativeFn,
        hangingReaddir,
      );
      const elapsed = Date.now() - started;

      // Before the per-probe budget existed, the probe and the whole call
      // shared one deadline, so this rejected instead of returning.
      expect(
        results.map(({ mountPoint, status }) => ({ mountPoint, status })),
      ).toEqual(
        expect.arrayContaining([
          { mountPoint: deadDir, status: "timeout" },
          { mountPoint: liveDir, status: "healthy" },
        ]),
      );
      // Gave up at the probe budget, well before the whole-call deadline.
      expect(elapsed).toBeLessThan(timeoutMs);
    });
  });

  describe("healthProbeTimeoutMs()", () => {
    it("stays strictly below the whole-call budget", () => {
      for (const timeoutMs of [4, 100, 5_000, 30_000, 86_399_999]) {
        const probe = healthProbeTimeoutMs(timeoutMs);
        expect(probe).toBeGreaterThan(0);
        expect(probe).toBeLessThan(timeoutMs);
      }
    });

    it("uses the documented fraction", () => {
      expect(healthProbeTimeoutMs(5_000)).toBe(
        5_000 / HealthProbeTimeoutDivisor,
      );
      expect(healthProbeTimeoutMs(30_000)).toBe(
        30_000 / HealthProbeTimeoutDivisor,
      );
    });

    it("propagates disabled timeouts", () => {
      expect(healthProbeTimeoutMs(0)).toBe(0);
    });

    it("never rounds down to zero", () => {
      // withTimeout() reads 0 as "no timeout" — rounding a tiny budget down to
      // 0 would silently restore an unbounded probe.
      for (const timeoutMs of [1, 2, 3]) {
        expect(healthProbeTimeoutMs(timeoutMs)).toBe(1);
      }
    });
  });
});
