import { jest } from "@jest/globals";
import type { execFile } from "node:child_process";
import {
  getZfsGuids,
  parseZfsGuid,
  runZfsCommand,
  ZfsEnrichmentReserveMs,
  zfsEnrichmentTimeoutMs,
  type ZfsCommandRunner,
} from "./zfs_guids";

describe("zfsEnrichmentTimeoutMs", () => {
  it("disables the command timeout when there is no deadline", () => {
    // deadlineMs == null mirrors timeoutMs === 0 ("no timeout"): the query runs
    // with an unbounded execFile timeout rather than being skipped.
    expect(zfsEnrichmentTimeoutMs(undefined, 1_000)).toBe(0);
  });

  it("returns the remaining budget minus the teardown reserve", () => {
    expect(zfsEnrichmentTimeoutMs(1_000, 700)).toBe(
      300 - ZfsEnrichmentReserveMs,
    );
    expect(zfsEnrichmentTimeoutMs(1_000, 0, 100)).toBe(900);
  });

  it("skips enrichment once the reserve would be exceeded", () => {
    // Exactly the reserve leaves zero budget, which is treated as "skip" (a 0
    // timeout would otherwise mean "no timeout").
    expect(
      zfsEnrichmentTimeoutMs(1_000, 1_000 - ZfsEnrichmentReserveMs),
    ).toBeUndefined();
    // Past the deadline.
    expect(zfsEnrichmentTimeoutMs(1_000, 1_200)).toBeUndefined();
    // One millisecond of headroom is enough to run.
    expect(
      zfsEnrichmentTimeoutMs(1_000, 1_000 - ZfsEnrichmentReserveMs - 1),
    ).toBe(1);
  });
});

describe("zfs GUID enrichment", () => {
  it("parses unsigned 64-bit GUIDs as decimal strings", () => {
    expect(parseZfsGuid(" 18446744073709551615\n")).toBe(
      "18446744073709551615",
    );
    expect(parseZfsGuid("00042\n")).toBe("42");

    for (const invalid of [
      "",
      "0",
      "-1",
      "1.5",
      "not-a-guid",
      "18446744073709551616",
    ]) {
      expect(parseZfsGuid(invalid)).toBeUndefined();
    }
  });

  it("queries the dataset and its pool without a shell", async () => {
    const calls: Array<{ command: string; args: string[]; timeoutMs: number }> =
      [];
    const run: ZfsCommandRunner = async (command, args, timeoutMs) => {
      calls.push({ command, args, timeoutMs });
      return command === "zfs" ? "123\n" : "456\n";
    };

    await expect(
      getZfsGuids({ dataset: "tank/photos", timeoutMs: 3210, run }),
    ).resolves.toEqual({
      zfsDatasetGuid: "123",
      zfsPoolGuid: "456",
    });
    expect(calls).toEqual([
      {
        command: "zfs",
        args: ["get", "-Hp", "-o", "value", "guid", "tank/photos"],
        timeoutMs: 3210,
      },
      {
        command: "zpool",
        args: ["get", "-Hp", "-o", "value", "guid", "tank"],
        timeoutMs: 3210,
      },
    ]);
  });

  it("returns whichever GUIDs are available", async () => {
    const run: ZfsCommandRunner = async (command) => {
      if (command === "zpool") throw new Error("zpool unavailable");
      return "123\n";
    };

    await expect(
      getZfsGuids({ dataset: "tank/photos", timeoutMs: 5000, run }),
    ).resolves.toEqual({ zfsDatasetGuid: "123" });
  });

  it("fails open when a command runner never settles", async () => {
    jest.useFakeTimers();
    try {
      const run: ZfsCommandRunner = () => new Promise(() => {});
      const result = getZfsGuids({
        dataset: "tank/photos",
        timeoutMs: 100,
        run,
      });

      await jest.advanceTimersByTimeAsync(100);
      await expect(result).resolves.toEqual({});
    } finally {
      jest.useRealTimers();
    }
  });

  it("settles and detaches a subprocess that ignores SIGTERM", async () => {
    jest.useFakeTimers();
    try {
      const kill = jest.fn(() => true);
      const destroyStdin = jest.fn();
      const destroyStdout = jest.fn();
      const destroyStderr = jest.fn();
      const unref = jest.fn();
      const exec = jest.fn(() => ({
        kill,
        stdin: { destroy: destroyStdin },
        stdout: { destroy: destroyStdout },
        stderr: { destroy: destroyStderr },
        unref,
      })) as unknown as typeof execFile;

      const result = runZfsCommand("zfs", ["get", "guid"], 100, exec);
      const rejection = expect(result).rejects.toThrow(
        "zfs GUID query: timeout after 100ms",
      );

      await jest.advanceTimersByTimeAsync(100);
      await rejection;
      expect(kill).toHaveBeenCalledWith("SIGTERM");
      expect(destroyStdin).toHaveBeenCalledTimes(1);
      expect(destroyStdout).toHaveBeenCalledTimes(1);
      expect(destroyStderr).toHaveBeenCalledTimes(1);
      expect(unref).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not query malformed dataset names", async () => {
    let called = false;
    const run: ZfsCommandRunner = async () => {
      called = true;
      return "123\n";
    };

    for (const dataset of ["", "/photos", "-tank/photos", "tank//photos"]) {
      await expect(
        getZfsGuids({ dataset, timeoutMs: 5000, run }),
      ).resolves.toEqual({});
    }
    expect(called).toBe(false);
  });

  it("deduplicates concurrent pool queries but does not retain a stale cache", async () => {
    jest.useFakeTimers();
    try {
      let poolCalls = 0;
      let poolGuid = 100;
      const run: ZfsCommandRunner = async (command) => {
        if (command === "zpool") {
          poolCalls++;
          return String(poolGuid);
        }
        return "200";
      };

      const [a, b] = await Promise.all([
        getZfsGuids({ dataset: "tank/a", timeoutMs: 5000, run }),
        getZfsGuids({ dataset: "tank/b", timeoutMs: 5000, run }),
      ]);
      expect(a.zfsPoolGuid).toBe("100");
      expect(b.zfsPoolGuid).toBe("100");
      expect(poolCalls).toBe(1);

      poolGuid = 101;
      await expect(
        getZfsGuids({ dataset: "tank/a", timeoutMs: 5000, run }),
      ).resolves.toEqual({ zfsDatasetGuid: "200", zfsPoolGuid: "101" });
      expect(poolCalls).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not give an unbounded caller a shorter pool-query budget", async () => {
    const poolTimeouts: number[] = [];
    const run: ZfsCommandRunner = async (command, _args, timeoutMs) => {
      if (command === "zpool") poolTimeouts.push(timeoutMs);
      return command === "zpool" ? "100" : "200";
    };

    await Promise.all([
      getZfsGuids({ dataset: "tank/a", timeoutMs: 25, run }),
      getZfsGuids({ dataset: "tank/b", timeoutMs: 0, run }),
    ]);
    expect(poolTimeouts).toEqual([25, 0]);
  });

  it("shares a longer-budget pool query with a shorter-budget caller", async () => {
    jest.useFakeTimers();
    try {
      let poolCalls = 0;
      const run: ZfsCommandRunner = (command) => {
        if (command === "zfs") return Promise.resolve("200");
        poolCalls++;
        return new Promise(() => {});
      };

      const long = getZfsGuids({
        dataset: "tank/a",
        timeoutMs: 1000,
        run,
      });
      const short = getZfsGuids({
        dataset: "tank/b",
        timeoutMs: 100,
        run,
      });

      await jest.advanceTimersByTimeAsync(100);
      await expect(short).resolves.toEqual({ zfsDatasetGuid: "200" });
      expect(poolCalls).toBe(1);

      await jest.advanceTimersByTimeAsync(900);
      await expect(long).resolves.toEqual({ zfsDatasetGuid: "200" });
    } finally {
      jest.useRealTimers();
    }
  });

  it("starts a new pool query when an older request expires too soon", async () => {
    jest.useFakeTimers();
    try {
      let poolCalls = 0;
      const run: ZfsCommandRunner = (command) => {
        if (command === "zfs") return Promise.resolve("200");
        poolCalls++;
        if (poolCalls === 1) return new Promise(() => {});
        return new Promise((resolve) => {
          setTimeout(() => resolve("100"), 70);
        });
      };

      const first = getZfsGuids({
        dataset: "tank/a",
        timeoutMs: 100,
        run,
      });
      await jest.advanceTimersByTimeAsync(80);

      const second = getZfsGuids({
        dataset: "tank/b",
        timeoutMs: 100,
        run,
      });
      expect(poolCalls).toBe(2);

      await jest.advanceTimersByTimeAsync(70);
      await expect(first).resolves.toEqual({ zfsDatasetGuid: "200" });
      await expect(second).resolves.toEqual({
        zfsDatasetGuid: "200",
        zfsPoolGuid: "100",
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
