import { jest } from "@jest/globals";
import { times } from "./array";
import { delay, mapConcurrent, TimeoutError, withTimeout } from "./async";
import { isArm, isWindows } from "./platform";
import { DayMs, HourMs } from "./units";

describe("async", () => {
  describe("withTimeout", () => {
    const delayedReject = (ms: number): Promise<never> =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("delayed rejection")), ms),
      );

    describe("Input validation", () => {
      it("should throw TypeError for non-number timeout", async () => {
        const promise = Promise.resolve("test");
        const invalidTimeouts: unknown[] = [
          null,
          undefined,
          "100",
          true,
          false,
          {},
          [],
          () => 100,
        ];

        for (const timeoutMs of invalidTimeouts) {
          await expect(
            withTimeout({
              promise,
              timeoutMs: timeoutMs as number,
              desc: "timeoutMs: " + JSON.stringify(timeoutMs),
            }),
          ).rejects.toThrow(TypeError);
        }
      });

      it("should throw TypeError for negative timeout", async () => {
        const promise = Promise.resolve("test");
        await expect(
          withTimeout({
            promise,
            timeoutMs: -1,
          }),
        ).rejects.toThrow(TypeError);
        await expect(() =>
          withTimeout({ promise, timeoutMs: -100 }),
        ).rejects.toThrow(TypeError);
      });

      it("should handle various valid timeout values", async () => {
        const promise = Promise.resolve("test");

        // Zero timeout
        await expect(withTimeout({ promise, timeoutMs: 0 })).resolves.toBe(
          "test",
        );

        // Floating point timeouts
        await expect(withTimeout({ promise, timeoutMs: 100.6 })).resolves.toBe(
          "test",
        );
        await expect(withTimeout({ promise, timeoutMs: 100.1 })).resolves.toBe(
          "test",
        );
      });
    });

    describe("Promise handling", () => {
      it("should handle various resolution scenarios", async () => {
        // Normal resolution before timeout
        await expect(
          withTimeout({
            promise: delay(50).then(() => "success"),
            timeoutMs: 200,
          }),
        ).resolves.toBe("success");

        // Immediate resolution
        await expect(
          withTimeout({ promise: Promise.resolve("instant"), timeoutMs: 200 }),
        ).resolves.toBe("instant");

        // Test different value types
        const testValues = [
          "string value",
          123,
          { key: "value" },
          [1, 2, 3],
          true,
          null,
        ];

        for (const value of testValues) {
          await expect(
            withTimeout({ promise: Promise.resolve(value), timeoutMs: 200 }),
          ).resolves.toBe(value);
        }
      });

      it("should handle immediate rejection", async () => {
        await expect(
          withTimeout({
            promise: Promise.reject(new Error("instant failure")),
            timeoutMs: 200,
          }),
        ).rejects.toThrow("instant failure");
      });

      it("should handle delayed rejection", async () => {
        await expect(
          withTimeout({ promise: delayedReject(50), timeoutMs: 200 }),
        ).rejects.toThrow("delayed rejection");
      });

      it("should handle never settling promise", async () => {
        const neverSettle = new Promise(() => {});
        await expect(
          withTimeout({ promise: neverSettle, timeoutMs: 100 }),
        ).rejects.toThrow(TimeoutError);
      });

      it("should resolve when promise completes before timeout", async () => {
        await expect(
          withTimeout({
            promise: delay(50).then(() => "success"),
            timeoutMs: 200,
          }),
        ).resolves.toBe("success");
      });
    });

    describe("Timeout behavior", () => {
      it("should reject with TimeoutError when promise exceeds timeout", async () => {
        const result = withTimeout({ promise: delay(200), timeoutMs: 50 });
        await expect(result).rejects.toThrow(TimeoutError);
        await expect(result).rejects.toThrow(/timeout after 50ms/);
      });

      it("should clear timeout when promise resolves", async () => {
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

        await withTimeout({ promise: delay(50), timeoutMs: 200 });

        expect(clearTimeoutSpy).toHaveBeenCalled();
        clearTimeoutSpy.mockRestore();
      });

      it("should clear timeout when promise rejects", async () => {
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

        await expect(
          withTimeout({ promise: delayedReject(50), timeoutMs: 200 }),
        ).rejects.toThrow("delayed rejection");

        expect(clearTimeoutSpy).toHaveBeenCalled();
        clearTimeoutSpy.mockRestore();
      });

      it("should maintain proper timing with multiple concurrent timeouts", async () => {
        const promises = [
          delay(50, "first"),
          delay(150, "second"),
          delay(250, "third"),
        ];

        const results = await Promise.allSettled(
          promises.map((p) => withTimeout({ promise: p, timeoutMs: 100 })),
        );

        expect(results[0]).toEqual(
          expect.objectContaining({
            status: "fulfilled",
            value: "first",
          }),
        );
        expect(results[1]).toEqual(
          expect.objectContaining({
            status: "rejected",
            reason: expect.any(TimeoutError),
          }),
        );
        expect(results[2]).toEqual(
          expect.objectContaining({
            status: "rejected",
            reason: expect.any(TimeoutError),
          }),
        );
      });
    });

    describe("Nested timeouts", () => {
      it("should propagate inner timeout error when inner timeout is smaller", async () => {
        const innerWrapped = withTimeout({
          promise: delay(300),
          timeoutMs: 100,
          desc: "inner",
        });
        const outerWrapped = withTimeout({
          promise: innerWrapped,
          timeoutMs: 200,
          desc: "outer",
        });

        await expect(outerWrapped).rejects.toThrow(
          /inner: timeout after 100ms/,
        );
      });

      it("should use outer timeout error when outer timeout is smaller", async () => {
        const innerWrapped = withTimeout({
          promise: delay(300),
          timeoutMs: 200,
          desc: "inner",
        });
        const outerWrapped = withTimeout({
          promise: innerWrapped,
          timeoutMs: 100,
          desc: "outer",
        });

        await expect(outerWrapped).rejects.toThrow(
          /outer: timeout after 100ms/,
        );
      });

      it("should handle triple-wrapped timeouts correctly", async () => {
        const wrap1 = withTimeout({
          promise: delay(400),
          timeoutMs: 100,
          desc: "first",
        });
        const wrap2 = withTimeout({
          promise: wrap1,
          timeoutMs: 200,
          desc: "second",
        });
        const wrap3 = withTimeout({
          promise: wrap2,
          timeoutMs: 300,
          desc: "third",
        });

        await expect(wrap3).rejects.toThrow(/first: timeout after 100ms/);
      });

      it("should handle same timeout values in nested wrappers", async () => {
        const inner = withTimeout({
          promise: delay(300),
          timeoutMs: 150,
          desc: "inner",
        });
        const outer = withTimeout({
          promise: inner,
          timeoutMs: 150,
          desc: "outer",
        });

        await expect(outer).rejects.toThrow(/inner: timeout after 150ms/);
      });

      it("should resolve if promise completes before any timeout", async () => {
        const inner = withTimeout({
          promise: delay(50).then(() => "success"),
          timeoutMs: 200,
          desc: "inner",
        });
        const outer = withTimeout({
          promise: inner,
          timeoutMs: 300,
          desc: "outer",
        });

        await expect(outer).resolves.toBe("success");
      });
    });

    describe("Edge cases", () => {
      it("should handle floating point timeout values", async () => {
        const promise = Promise.resolve("test");
        await expect(withTimeout({ promise, timeoutMs: 100.6 })).resolves.toBe(
          "test",
        );
        await expect(withTimeout({ promise, timeoutMs: 100.1 })).resolves.toBe(
          "test",
        );
      });

      it("should handle very large timeout values", async () => {
        const promise = Promise.resolve("test");
        await expect(
          withTimeout({ promise, timeoutMs: HourMs }),
        ).resolves.toEqual("test");
        await expect(
          withTimeout({ promise, timeoutMs: 2 * DayMs }),
        ).rejects.toThrow(/too large/);
      });

      it("should handle promises that never settle", async () => {
        const neverSettle = new Promise(() => {});
        const result = withTimeout({ promise: neverSettle, timeoutMs: 100 });
        await expect(result).rejects.toThrow(TimeoutError);
      });

      it("should handle promises with no error handler", async () => {
        const promise = delayedReject(50);
        const result = withTimeout({ promise, timeoutMs: 200 });
        await expect(result).rejects.toThrow("delayed rejection");
      });
    });

    describe("Cleanup", () => {
      it("should not leave hanging timeouts on resolution", async () => {
        const timeoutSpy = jest.spyOn(global, "setTimeout");
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

        await withTimeout({ promise: delay(50), timeoutMs: 200 });

        expect(clearTimeoutSpy).toHaveBeenCalled();
        expect(timeoutSpy).toHaveBeenCalledTimes(2); // One for delay, one for timeout

        timeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
      });

      it("should not leave hanging timeouts on rejection", async () => {
        const timeoutSpy = jest.spyOn(global, "setTimeout");
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

        await expect(
          withTimeout({ promise: delayedReject(50), timeoutMs: 200 }),
        ).rejects.toThrow();

        expect(clearTimeoutSpy).toHaveBeenCalled();
        expect(timeoutSpy).toHaveBeenCalledTimes(2);

        timeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
      });
    });
  });

  describe("mapConcurrent()", () => {
    describe("Concurrency control", () => {
      it("handles an empty items array", async () => {
        const items: number[] = [];
        const mockFn = jest.fn(async (item: number) => item);

        const results = await mapConcurrent({
          items,
          fn: mockFn,
        });

        expect(results).toEqual([]);
        expect(mockFn).not.toHaveBeenCalled();
      });

      for (const maxConcurrency of [1, 2, 5]) {
        it(`handles an empty items array with maxConcurrency ${maxConcurrency}`, async () => {
          const items: number[] = [1, 2, 3, 4, 5];

          let concurrentCalls = 0;
          let maxConcurrentCalls = 0;

          const results = await mapConcurrent({
            items,
            fn: async (item: number) => {
              concurrentCalls++;
              maxConcurrentCalls = Math.max(
                maxConcurrentCalls,
                concurrentCalls,
              );
              await delay(50);
              concurrentCalls--;
              return item * 2;
            },
            maxConcurrency,
          });

          expect(results).toEqual([2, 4, 6, 8, 10]);
          expect(maxConcurrentCalls).toBeLessThanOrEqual(maxConcurrency);
        });
      }

      it("works with high maxConcurrency", async () => {
        const maxConcurrency = 10;
        const items = times(maxConcurrency, (i) => i);
        const start = Date.now();
        const results = await mapConcurrent({
          items,
          fn: async (item: number) => {
            await delay(100);
            return item * 2; // < just to prove that the result is passed through and in the correct order
          },
          maxConcurrency,
        });
        expect(results).toEqual(times(10, (i) => i * 2));
        // This should complete in ~100ms, but GHA runners are slow -- the alpine ARM runner took 243ms (!!)
        // Alpine on ARM64 is exceptionally slow and has been seen to take 392ms
        expect(Date.now() - start).toBeLessThan(isArm || isWindows ? 500 : 200);
      });

      it("should maintain proper order even with varying execution times", async () => {
        const items = [1, 2, 3, 4, 5];
        const results = await mapConcurrent({
          items,
          fn: async (item) => {
            await delay(100 / item); // Faster execution for larger numbers
            return item * 2;
          },
          maxConcurrency: 2,
        });

        expect(results).toEqual([2, 4, 6, 8, 10]);
      });
    });

    describe("Error handling", () => {
      it("handles errors in the async function", async () => {
        const error = new Error("Test error");
        const items = [1, 2, 3];
        expect(
          mapConcurrent({
            items,
            fn: async (item: number) => {
              if (item === 2) throw error;
              return item * 10;
            },
          }),
        ).resolves.toEqual([10, error, 30]);
      });

      it("should handle multiple concurrent errors properly", async () => {
        const items = [1, 2, 3, 4, 5];

        await expect(
          mapConcurrent({
            items,
            fn: async (item) => {
              if (item % 2 === 0) throw new Error(`Error for ${item}`);
              return item;
            },
            maxConcurrency: 4,
          }),
        ).resolves.toEqual([
          1,
          new Error("Error for 2"),
          3,
          new Error("Error for 4"),
          5,
        ]);
      });

      it("should clean up properly when an error occurs", async () => {
        const items = [1, 2, 3];
        const error = new Error("Test error");
        let concurrentCalls = 0;

        await expect(
          mapConcurrent({
            items,
            fn: async (item) => {
              concurrentCalls++;
              try {
                if (item === 2) throw error;
                await delay(50);
                return item;
              } finally {
                concurrentCalls--;
              }
            },
            maxConcurrency: 2,
          }),
        ).resolves.toEqual([1, error, 3]);

        expect(concurrentCalls).toBe(0);
      });
    });

    describe("Edge cases", () => {
      it("should handle maxConcurrency greater than items length", async () => {
        const items = [1, 2, 3];
        const results = await mapConcurrent({
          items,
          fn: async (item) => item * 2,
          maxConcurrency: 10,
        });

        expect(results).toEqual([2, 4, 6]);
      });

      it("should handle invalid maxConcurrency values", async () => {
        const items = [1, 2, 3];

        await expect(
          mapConcurrent({
            items,
            fn: async (item) => item,
            maxConcurrency: 0,
          }),
        ).rejects.toThrow();

        await expect(
          mapConcurrent({
            items,
            fn: async (item) => item,
            maxConcurrency: -1,
          }),
        ).rejects.toThrow();
      });
    });
  });
});
