import { jest } from "@jest/globals";
import {
  createAvailableSpaceWatcher,
  getAvailableBytes,
  type AvailableSpaceChange,
} from "./available_space_watcher";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("available space watcher", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("calculates caller-available bytes from bavail and bsize", async () => {
    const statfs = jest.fn(async () => ({ bavail: 7n, bsize: 4096n }));
    await expect(getAvailableBytes("/data", statfs)).resolves.toBe(28_672);
    expect(statfs).toHaveBeenCalledWith("/data");
  });

  it("rejects invalid statfs block counts", async () => {
    await expect(
      getAvailableBytes("/data", async () => ({ bavail: -1n, bsize: 4096n })),
    ).rejects.toThrow(/invalid block counts/);
    await expect(
      getAvailableBytes("/data", async () => ({ bavail: 1n, bsize: 0n })),
    ).rejects.toThrow(/invalid block counts/);
  });

  it("returns the initial predicate state through ready", async () => {
    const listener = jest.fn<(change: AvailableSpaceChange) => void>();
    const watcher = createAvailableSpaceWatcher(
      "/data",
      { minimumAvailableBytes: 100, pollIntervalMs: 60_000 },
      async () => 101,
      listener,
    );

    await expect(watcher.ready).resolves.toEqual({
      path: "/data",
      availableBytes: 101,
      state: "aboveMinimum",
    });
    expect(listener).not.toHaveBeenCalled();
    watcher.close();
  });

  it("emits only threshold crossings and applies recovery hysteresis", async () => {
    const listener = jest.fn<(change: AvailableSpaceChange) => void>();
    const probe = jest
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(120)
      .mockResolvedValueOnce(99)
      .mockResolvedValueOnce(105)
      .mockResolvedValueOnce(109)
      .mockResolvedValueOnce(110);
    const watcher = createAvailableSpaceWatcher(
      "/data",
      {
        minimumAvailableBytes: 100,
        hysteresisBytes: 10,
        pollIntervalMs: 25,
      },
      probe,
      listener,
    );
    await watcher.ready;

    await jest.advanceTimersByTimeAsync(25);
    expect(listener).toHaveBeenLastCalledWith({
      previous: {
        path: "/data",
        availableBytes: 120,
        state: "aboveMinimum",
      },
      current: {
        path: "/data",
        availableBytes: 99,
        state: "belowMinimum",
      },
    });

    await jest.advanceTimersByTimeAsync(50);
    expect(listener).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(25);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({
      previous: {
        path: "/data",
        availableBytes: 109,
        state: "belowMinimum",
      },
      current: {
        path: "/data",
        availableBytes: 110,
        state: "aboveMinimum",
      },
    });
    watcher.close();
  });

  it("does not turn probe errors into below-minimum transitions", async () => {
    const listener = jest.fn<(change: AvailableSpaceChange) => void>();
    const onError = jest.fn<(error: Error) => void>();
    const probe = jest
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(200)
      .mockRejectedValueOnce(new Error("statfs failed"))
      .mockResolvedValueOnce(50);
    const watcher = createAvailableSpaceWatcher(
      "/data",
      { minimumAvailableBytes: 100, pollIntervalMs: 20 },
      probe,
      listener,
    );
    watcher.on("error", onError);
    await watcher.ready;

    await jest.advanceTimersByTimeAsync(20);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "statfs failed" }),
    );
    expect(listener).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(20);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0].current.state).toBe("belowMinimum");
    watcher.close();
  });

  it("does not start another probe while a timed-out probe is still running", async () => {
    const slow = deferred<number>();
    const onError = jest.fn<(error: Error) => void>();
    const probe = jest
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(200)
      .mockImplementationOnce(() => slow.promise)
      .mockResolvedValue(200);
    const watcher = createAvailableSpaceWatcher(
      "/data",
      {
        minimumAvailableBytes: 100,
        pollIntervalMs: 20,
        timeoutMs: 10,
      },
      probe,
    );
    watcher.on("error", onError);
    await watcher.ready;

    await jest.advanceTimersByTimeAsync(30);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ name: "TimeoutError" }),
    );
    expect(probe).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(200);
    expect(probe).toHaveBeenCalledTimes(2);

    slow.resolve(200);
    await slow.promise;
    await jest.advanceTimersByTimeAsync(20);
    expect(probe).toHaveBeenCalledTimes(3);
    watcher.close();
  });

  it("supports AbortSignal and timer ref state", async () => {
    const controller = new AbortController();
    const probe = jest.fn(async () => 200);
    const watcher = createAvailableSpaceWatcher(
      "/data",
      {
        minimumAvailableBytes: 100,
        pollIntervalMs: 20,
        persistent: false,
        signal: controller.signal,
      },
      probe,
    );
    await watcher.ready;

    expect(watcher.hasRef()).toBe(false);
    watcher.ref();
    expect(watcher.hasRef()).toBe(true);
    watcher.unref();
    expect(watcher.hasRef()).toBe(false);

    controller.abort();
    await jest.advanceTimersByTimeAsync(100);
    expect(watcher.closed).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("treats equality with the minimum as above-minimum", async () => {
    const watcher = createAvailableSpaceWatcher(
      "/data",
      { minimumAvailableBytes: 100, pollIntervalMs: 20 },
      async () => 100,
    );
    await expect(watcher.ready).resolves.toMatchObject({
      availableBytes: 100,
      state: "aboveMinimum",
    });
    watcher.close();
  });

  it("validates the path and numeric thresholds", () => {
    const probe = async () => 100;
    expect(() =>
      createAvailableSpaceWatcher(
        " ",
        { minimumAvailableBytes: 1, pollIntervalMs: 100 },
        probe,
      ),
    ).toThrow(/path/);
    expect(() =>
      createAvailableSpaceWatcher(
        "/",
        { minimumAvailableBytes: -1, pollIntervalMs: 100 },
        probe,
      ),
    ).toThrow(/minimumAvailableBytes/);
    expect(() =>
      createAvailableSpaceWatcher(
        "/",
        {
          minimumAvailableBytes: 1,
          hysteresisBytes: -1,
          pollIntervalMs: 100,
        },
        probe,
      ),
    ).toThrow(/hysteresisBytes/);
    for (const minimumAvailableBytes of [
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() =>
        createAvailableSpaceWatcher(
          "/",
          { minimumAvailableBytes, pollIntervalMs: 100 },
          probe,
        ),
      ).toThrow(/minimumAvailableBytes/);
    }
  });
});
