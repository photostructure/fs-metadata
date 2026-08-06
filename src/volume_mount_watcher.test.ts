import { jest } from "@jest/globals";
import type { MountPoint } from "./types/mount_point";
import {
  createVolumeMountWatcher,
  validateVolumeMountWatcherOptions,
  volumeMountPathKey,
  type VolumeMountChange,
} from "./volume_mount_watcher";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mount = (mountPoint: string): MountPoint => ({ mountPoint });

describe("volume mount watcher", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("case-folds Windows mount roots without changing POSIX keys", () => {
    expect(volumeMountPathKey("C:\\", true)).toBe("c:\\");
    expect(volumeMountPathKey("/Volumes/Data", false)).toBe("/Volumes/Data");
  });

  it("returns the baseline through ready without manufacturing additions", async () => {
    const listener = jest.fn<(change: VolumeMountChange) => void>();
    const scan = jest.fn(async () => [mount("/"), mount("/data")]);
    const watcher = createVolumeMountWatcher(
      { pollIntervalMs: 60_000 },
      scan,
      listener,
    );

    await expect(watcher.ready).resolves.toEqual([mount("/"), mount("/data")]);
    expect(listener).not.toHaveBeenCalled();
    expect(scan).toHaveBeenCalledTimes(1);
    watcher.close();
  });

  it("emits one atomic batch containing additions and removals", async () => {
    const listener = jest.fn<(change: VolumeMountChange) => void>();
    const scan = jest
      .fn<() => Promise<MountPoint[]>>()
      .mockResolvedValueOnce([mount("/"), mount("/old")])
      .mockResolvedValueOnce([mount("/"), mount("/new")]);
    const watcher = createVolumeMountWatcher(
      { pollIntervalMs: 100 },
      scan,
      listener,
    );
    await watcher.ready;

    await jest.advanceTimersByTimeAsync(100);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      generation: 1,
      added: [mount("/new")],
      removed: [mount("/old")],
    });
    watcher.close();
  });

  it("does not emit when the observed mount paths are unchanged", async () => {
    const listener = jest.fn<(change: VolumeMountChange) => void>();
    const scan = jest.fn(async () => [mount("/")]);
    const watcher = createVolumeMountWatcher(
      { pollIntervalMs: 25 },
      scan,
      listener,
    );
    await watcher.ready;

    await jest.advanceTimersByTimeAsync(75);

    expect(scan).toHaveBeenCalledTimes(4);
    expect(listener).not.toHaveBeenCalled();
    watcher.close();
  });

  it("retains the last good snapshot after a polling error", async () => {
    const listener = jest.fn<(change: VolumeMountChange) => void>();
    const onError = jest.fn<(error: Error) => void>();
    const scan = jest
      .fn<() => Promise<MountPoint[]>>()
      .mockResolvedValueOnce([mount("/")])
      .mockRejectedValueOnce(new Error("transient snapshot failure"))
      .mockResolvedValueOnce([mount("/"), mount("/data")]);
    const watcher = createVolumeMountWatcher(
      { pollIntervalMs: 50 },
      scan,
      listener,
    );
    watcher.on("error", onError);
    await watcher.ready;

    await jest.advanceTimersByTimeAsync(50);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "transient snapshot failure" }),
    );
    expect(listener).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(50);
    expect(listener).toHaveBeenCalledWith({
      generation: 1,
      added: [mount("/data")],
      removed: [],
    });
    watcher.close();
  });

  it("never overlaps slow snapshots", async () => {
    const slow = deferred<MountPoint[]>();
    const scan = jest
      .fn<() => Promise<MountPoint[]>>()
      .mockResolvedValueOnce([mount("/")])
      .mockImplementationOnce(() => slow.promise)
      .mockResolvedValue([mount("/")]);
    const watcher = createVolumeMountWatcher({ pollIntervalMs: 20 }, scan);
    await watcher.ready;

    await jest.advanceTimersByTimeAsync(20);
    expect(scan).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(200);
    expect(scan).toHaveBeenCalledTimes(2);

    slow.resolve([mount("/")]);
    await slow.promise;
    await jest.advanceTimersByTimeAsync(20);
    expect(scan).toHaveBeenCalledTimes(3);
    watcher.close();
  });

  it("reports snapshot timeouts without overlapping the raw work", async () => {
    const raw = deferred<MountPoint[]>();
    const onError = jest.fn<(error: Error) => void>();
    const scan = jest
      .fn<
        () =>
          | Promise<MountPoint[]>
          | {
              value: Promise<MountPoint[]>;
              settled: Promise<unknown>;
            }
      >()
      .mockReturnValueOnce(Promise.resolve([mount("/")]))
      .mockReturnValueOnce({ value: raw.promise, settled: raw.promise })
      .mockReturnValue(Promise.resolve([mount("/")]));
    const watcher = createVolumeMountWatcher(
      { pollIntervalMs: 20, timeoutMs: 10 },
      scan,
    );
    watcher.on("error", onError);
    await watcher.ready;

    await jest.advanceTimersByTimeAsync(30);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ name: "TimeoutError" }),
    );
    expect(watcher.lastError?.name).toBe("TimeoutError");
    expect(watcher.closed).toBe(false);

    await jest.advanceTimersByTimeAsync(200);
    expect(scan).toHaveBeenCalledTimes(2);

    raw.resolve([mount("/")]);
    await raw.promise;
    await jest.advanceTimersByTimeAsync(20);
    expect(scan).toHaveBeenCalledTimes(3);
    expect(watcher.lastError).toBeUndefined();
    watcher.close();
  });

  it("bounds the initial snapshot and closes after its timeout", async () => {
    const raw = deferred<MountPoint[]>();
    const watcher = createVolumeMountWatcher({ timeoutMs: 10 }, () => ({
      value: raw.promise,
      settled: raw.promise,
    }));
    const ready = expect(watcher.ready).rejects.toMatchObject({
      name: "TimeoutError",
    });

    await jest.advanceTimersByTimeAsync(10);
    await ready;
    expect(watcher.lastError?.name).toBe("TimeoutError");
    expect(watcher.closed).toBe(true);

    raw.resolve([mount("/")]);
    await raw.promise;
  });

  it("supports close, AbortSignal, and timer ref state", async () => {
    const controller = new AbortController();
    const scan = jest.fn(async () => [mount("/")]);
    const watcher = createVolumeMountWatcher(
      { pollIntervalMs: 10, persistent: false, signal: controller.signal },
      scan,
    );
    await watcher.ready;

    expect(watcher.hasRef()).toBe(false);
    expect(watcher.ref()).toBe(watcher);
    expect(watcher.hasRef()).toBe(true);
    expect(watcher.unref()).toBe(watcher);
    expect(watcher.hasRef()).toBe(false);

    controller.abort();
    expect(watcher.closed).toBe(true);
    await jest.advanceTimersByTimeAsync(100);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(() => watcher.close()).not.toThrow();
  });

  it("rejects ready with AbortError when closed during the initial scan", async () => {
    const initial = deferred<MountPoint[]>();
    const watcher = createVolumeMountWatcher(
      { pollIntervalMs: 10 },
      () => initial.promise,
    );

    watcher.close();

    await expect(watcher.ready).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects ready when closed after an already-resolved initial scan", async () => {
    const watcher = createVolumeMountWatcher(
      { pollIntervalMs: 10 },
      async () => [mount("/")],
    );

    watcher.close();

    await expect(watcher.ready).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects ready when aborted after an already-resolved initial scan", async () => {
    const controller = new AbortController();
    const watcher = createVolumeMountWatcher(
      { pollIntervalMs: 10, signal: controller.signal },
      async () => [mount("/")],
    );

    controller.abort();

    await expect(watcher.ready).rejects.toMatchObject({ name: "AbortError" });
  });

  it("waits for raw snapshot work before scheduling another poll", async () => {
    const raw = deferred<undefined>();
    const scan = jest
      .fn<
        () => {
          value: Promise<MountPoint[]>;
          settled: Promise<unknown>;
        }
      >()
      .mockReturnValueOnce({
        value: Promise.resolve([mount("/")]),
        settled: Promise.resolve(),
      })
      .mockReturnValueOnce({
        value: Promise.resolve([mount("/")]),
        settled: raw.promise,
      })
      .mockReturnValue({
        value: Promise.resolve([mount("/")]),
        settled: Promise.resolve(),
      });
    const watcher = createVolumeMountWatcher({ pollIntervalMs: 10 }, scan);
    await watcher.ready;

    await jest.advanceTimersByTimeAsync(100);
    expect(scan).toHaveBeenCalledTimes(2);

    raw.resolve(undefined);
    await jest.advanceTimersByTimeAsync(10);
    expect(scan).toHaveBeenCalledTimes(3);
    watcher.close();
  });

  it("waits for raw initial work before starting the polling loop", async () => {
    const raw = deferred<undefined>();
    const scan = jest
      .fn<
        () => {
          value: Promise<MountPoint[]>;
          settled: Promise<unknown>;
        }
      >()
      .mockReturnValueOnce({
        value: Promise.resolve([mount("/")]),
        settled: raw.promise,
      })
      .mockReturnValue({
        value: Promise.resolve([mount("/")]),
        settled: Promise.resolve(),
      });
    const watcher = createVolumeMountWatcher({ pollIntervalMs: 10 }, scan);
    await watcher.ready;

    await jest.advanceTimersByTimeAsync(100);
    expect(scan).toHaveBeenCalledTimes(1);

    raw.resolve(undefined);
    await jest.advanceTimersByTimeAsync(10);
    expect(scan).toHaveBeenCalledTimes(2);
    watcher.close();
  });

  it("rejects custom systemFsTypes for shallow Windows observation", () => {
    expect(() =>
      validateVolumeMountWatcherOptions({ systemFsTypes: ["NTFS"] }, true),
    ).toThrow(/systemFsTypes.*Windows/);
    expect(() =>
      validateVolumeMountWatcherOptions({ systemFsTypes: ["ext4"] }, false),
    ).not.toThrow();
  });

  it("closes after an initial scan failure", async () => {
    const watcher = createVolumeMountWatcher(
      { pollIntervalMs: 10 },
      async () => {
        throw new Error("initial snapshot failed");
      },
    );

    await expect(watcher.ready).rejects.toThrow("initial snapshot failed");
    expect(watcher.closed).toBe(true);
    expect(watcher.lastError?.message).toBe("initial snapshot failed");
  });

  it("does not expose its cached snapshots to listener mutation", async () => {
    const listener = jest.fn((change: VolumeMountChange) => {
      const added = change.added[0];
      if (added != null) (added as MountPoint).mountPoint = "/mutated";
    });
    const scan = jest
      .fn<() => Promise<MountPoint[]>>()
      .mockResolvedValueOnce([mount("/")])
      .mockResolvedValueOnce([mount("/"), mount("/data")])
      .mockResolvedValueOnce([mount("/")]);
    const watcher = createVolumeMountWatcher(
      { pollIntervalMs: 10 },
      scan,
      listener,
    );
    await watcher.ready;

    await jest.advanceTimersByTimeAsync(20);

    expect(listener).toHaveBeenLastCalledWith({
      generation: 2,
      added: [],
      removed: [mount("/data")],
    });
    watcher.close();
  });

  it.each([0, -1, 1.5, 2_147_483_648, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid pollIntervalMs %p",
    (pollIntervalMs) => {
      expect(() =>
        createVolumeMountWatcher({ pollIntervalMs }, async () => [mount("/")]),
      ).toThrow(/pollIntervalMs/);
    },
  );

  it.each([-1, 86_400_001, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid snapshot timeoutMs %p before scanning",
    (timeoutMs) => {
      const scan = jest.fn(async () => [mount("/")]);
      expect(() => createVolumeMountWatcher({ timeoutMs }, scan)).toThrow(
        /watchVolumeMountPoints.*timeoutMs/,
      );
      expect(scan).not.toHaveBeenCalled();
    },
  );
});
