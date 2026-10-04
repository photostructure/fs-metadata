// src/windows-drive-status.test.ts
//
// Behavior of the Windows per-drive health check that repeated and concurrent
// callers share. The pile-up it prevents — one abandoned pool callback per
// call against a stalled mapped drive — needs a provider that blocks
// indefinitely, which nothing on this platform can synthesize; see
// windows-drive-status-source.test.ts for the properties covered at source
// level instead.

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getVolumeMetadata, getVolumeMountPoints } from "./index";
import { describePlatformStable, systemDrive } from "./test-utils/platform";
import type { MountPoint } from "./types/mount_point";

const execFileAsync = promisify(execFile);

describePlatformStable("win32")("Windows drive status", () => {
  const enumerate = () => getVolumeMountPoints({ includeSystemVolumes: true });
  const roots = (mountPoints: MountPoint[]) =>
    mountPoints.map((ea) => ea.mountPoint);

  describe("volume information", () => {
    it("reports fstype and isReadOnly for a healthy drive", async () => {
      // Both now come from GetVolumeInformationW inside the timed per-drive
      // callback rather than from an unbounded call after it, so losing them
      // is the regression this guards.
      //
      // Every healthy drive is asserted to carry `isReadOnly`, because the
      // native layer serializes it unconditionally; `fstype` is asserted for
      // at least one, because a drive whose GetVolumeInformationW answers
      // FALSE legitimately reports neither field. A drive whose query never
      // answers at all reports `timeout`, not `healthy`.
      const healthy = (await enumerate()).filter(
        (ea) => ea.status === "healthy",
      );
      expect(healthy.length).toBeGreaterThan(0);
      for (const mountPoint of healthy) {
        expect(typeof mountPoint.isReadOnly).toBe("boolean");
      }
      expect(
        healthy.filter((ea) => ea.fstype != null && ea.fstype !== "").length,
      ).toBeGreaterThan(0);
    });

    it("stays consistent across repeated enumerations", async () => {
      // A registry entry that outlived its callback would leave later calls
      // joining a future nobody will satisfy, so each call must report the
      // same drives with the same filesystem types.
      const first = (await enumerate())
        .filter((ea) => ea.status === "healthy")
        .map((ea) => `${ea.mountPoint}=${ea.fstype}`)
        .sort();
      expect(first.length).toBeGreaterThan(0);
      for (let i = 0; i < 10; i++) {
        const again = (await enumerate())
          .filter((ea) => ea.status === "healthy")
          .map((ea) => `${ea.mountPoint}=${ea.fstype}`)
          .sort();
        expect(again).toEqual(first);
      }
    });
  });

  describe("shared in-flight checks", () => {
    it("gives each concurrent caller of one drive its own deadline", async () => {
      // The impatient call abandons the shared check; the patient one must
      // still receive the check's real answer rather than inherit the
      // abandoned deadline.
      const [impatient, patient] = await Promise.all([
        getVolumeMountPoints({ timeoutMs: 1, includeSystemVolumes: true }),
        getVolumeMountPoints({ timeoutMs: 15_000, includeSystemVolumes: true }),
      ]);

      expect(roots(impatient)).toEqual(roots(patient));
      expect(
        patient.filter((ea) => ea.status === "healthy").length,
      ).toBeGreaterThan(0);
    });

    it("agrees across concurrent metadata and enumeration of one drive", async () => {
      const drive = systemDrive();
      const [first, second, third, enumerated] = await Promise.all([
        getVolumeMetadata(drive),
        getVolumeMetadata(drive),
        getVolumeMetadata(drive),
        enumerate(),
      ]);

      expect(first.status).toBe("healthy");
      expect(second.status).toBe(first.status);
      expect(third.status).toBe(first.status);
      expect(second.fstype).toBe(first.fstype);
      expect(third.fstype).toBe(first.fstype);

      const fromEnumeration = enumerated.find((ea) => ea.mountPoint === drive);
      expect(fromEnumeration).toMatchObject({
        status: "healthy",
        fstype: first.fstype,
      });
    });
  });

  describe("per-call probing", () => {
    it("probes a drive letter that appears and disappears between calls", async () => {
      // The registry coalesces checks that are still in flight; it is not a
      // cache of settled results. A drive substituted after one enumeration
      // must be probed by the next, and dropped again once it is gone.
      const dir = await mkdtemp(join(tmpdir(), "fs-metadata-subst-"));
      let letter: string | undefined;
      try {
        const taken = new Set(
          roots(await enumerate()).map((ea) => ea[0]?.toUpperCase()),
        );
        // Skips Z/Y/X, the letters most often already mapped by hand.
        for (const candidate of "WVUTSRQPONMLKJIHG") {
          if (taken.has(candidate)) continue;
          try {
            await execFileAsync("subst", [candidate + ":", dir]);
            letter = candidate;
            break;
          } catch {
            // Letter claimed by something enumeration cannot see (a network
            // mapping of another session, say). Try the next one.
          }
        }
        if (letter == null) {
          throw new Error("no free drive letter available for subst");
        }
        const root = letter + ":\\";

        const added = (await enumerate()).find((ea) => ea.mountPoint === root);
        expect(added).toMatchObject({ status: "healthy" });
        expect(added?.fstype).toBeTruthy();

        await execFileAsync("subst", ["/d", letter + ":"]);
        letter = undefined;
        expect(roots(await enumerate())).not.toContain(root);
      } finally {
        if (letter != null) {
          await execFileAsync("subst", ["/d", letter + ":"]).catch(() => {
            // Already gone, or never created.
          });
        }
        await rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      }
    });
  });
});
