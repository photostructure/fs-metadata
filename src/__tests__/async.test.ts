import { jest } from "@jest/globals";
import { times } from "../array.js";
import { delay, mapConcurrent, thenOrTimeout, TimeoutError } from "../async.js";

describe("async", () => {
  describe("thenOrTimeout", () => {
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
          expect(() =>
            thenOrTimeout(promise, {
              timeoutMs: timeoutMs as number,
              desc: "timeoutMs: " + JSON.stringify(timeoutMs),
            }),
          ).toThrow(TypeError);
        }
      });

      it("should throw TypeError for negative timeout", () => {
        const promise = Promise.resolve("test");
        expect(() => thenOrTimeout(promise, { timeoutMs: -1 })).toThrow(
          TypeError,
        );
        expect(() => thenOrTimeout(promise, { timeoutMs: -100 })).toThrow(
          TypeError,
        );
      });

      it("should handle zero timeout by returning original promise", async () => {
        const promise = Promise.resolve("test");
        const result = thenOrTimeout(promise, { timeoutMs: 0 });
        expect(result).toBe(promise);
        await expect(result).resolves.toBe("test");
      });
    });

    describe("Promise resolution", () => {
      it("should resolve when promise completes before timeout", async () => {
        const result = thenOrTimeout(
          delay(50).then(() => "success"),
          {
            timeoutMs: 200,
          },
        );
        await expect(result).resolves.toBe("success");
      });

      it("should handle immediate resolution", async () => {
        await expect(
          thenOrTimeout(Promise.resolve("instant"), { timeoutMs: 200 }),
        ).resolves.toBe("instant");
      });

      it("should handle immediate rejection", async () => {
        await expect(
          thenOrTimeout(Promise.reject(new Error("instant failure")), {
            timeoutMs: 200,
          }),
        ).rejects.toThrow("instant failure");
      });

      it("should resolve with the correct value when promise resolves", async () => {
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
            thenOrTimeout(Promise.resolve(value), { timeoutMs: 200 }),
          ).resolves.toBe(value);
        }
      });
    });

    describe("Timeout behavior", () => {
      it("should reject with TimeoutError when promise exceeds timeout", async () => {
        const result = thenOrTimeout(delay(200), { timeoutMs: 50 });
        await expect(result).rejects.toThrow(TimeoutError);
        await expect(result).rejects.toThrow(/timeout after 50ms/);
      });

      it("should clear timeout when promise resolves", async () => {
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

        await thenOrTimeout(delay(50), { timeoutMs: 200 });

        expect(clearTimeoutSpy).toHaveBeenCalled();
        clearTimeoutSpy.mockRestore();
      });

      it("should clear timeout when promise rejects", async () => {
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

        await expect(
          thenOrTimeout(delayedReject(50), { timeoutMs: 200 }),
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
          promises.map((p) => thenOrTimeout(p, { timeoutMs: 100 })),
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
        const innerWrapped = thenOrTimeout(delay(300), {
          timeoutMs: 100,
          desc: "inner",
        });
        const outerWrapped = thenOrTimeout(innerWrapped, {
          timeoutMs: 200,
          desc: "outer",
        });

        await expect(outerWrapped).rejects.toThrow(
          /inner: timeout after 100ms/,
        );
      });

      it("should use outer timeout error when outer timeout is smaller", async () => {
        const innerWrapped = thenOrTimeout(delay(300), {
          timeoutMs: 200,
          desc: "inner",
        });
        const outerWrapped = thenOrTimeout(innerWrapped, {
          timeoutMs: 100,
          desc: "outer",
        });

        await expect(outerWrapped).rejects.toThrow(
          /outer: timeout after 100ms/,
        );
      });

      it("should handle triple-wrapped timeouts correctly", async () => {
        const wrap1 = thenOrTimeout(delay(400), {
          timeoutMs: 100,
          desc: "first",
        });
        const wrap2 = thenOrTimeout(wrap1, {
          timeoutMs: 200,
          desc: "second",
        });
        const wrap3 = thenOrTimeout(wrap2, {
          timeoutMs: 300,
          desc: "third",
        });

        await expect(wrap3).rejects.toThrow(/first: timeout after 100ms/);
      });

      it("should handle same timeout values in nested wrappers", async () => {
        const inner = thenOrTimeout(delay(300), {
          timeoutMs: 150,
          desc: "inner",
        });
        const outer = thenOrTimeout(inner, {
          timeoutMs: 150,
          desc: "outer",
        });

        await expect(outer).rejects.toThrow(/inner: timeout after 150ms/);
      });

      it("should resolve if promise completes before any timeout", async () => {
        const inner = thenOrTimeout(
          delay(50).then(() => "success"),
          {
            timeoutMs: 200,
            desc: "inner",
          },
        );
        const outer = thenOrTimeout(inner, {
          timeoutMs: 300,
          desc: "outer",
        });

        await expect(outer).resolves.toBe("success");
      });
    });

    describe("Edge cases", () => {
      it("should handle floating point timeout values", async () => {
        const promise = Promise.resolve("test");
        await expect(
          thenOrTimeout(promise, { timeoutMs: 100.6 }),
        ).resolves.toBe("test");
        await expect(
          thenOrTimeout(promise, { timeoutMs: 100.1 }),
        ).resolves.toBe("test");
      });

      it("should handle very large timeout values", async () => {
        const promise = Promise.resolve("test");
        await expect(
          thenOrTimeout(promise, { timeoutMs: Number.MAX_SAFE_INTEGER }),
        ).resolves.toBe("test");
      });

      it("should handle promises that never settle", async () => {
        const neverSettle = new Promise(() => {});
        const result = thenOrTimeout(neverSettle, { timeoutMs: 100 });
        await expect(result).rejects.toThrow(TimeoutError);
      });

      it("should handle promises with no error handler", async () => {
        const promise = delayedReject(50);
        const result = thenOrTimeout(promise, { timeoutMs: 200 });
        await expect(result).rejects.toThrow("delayed rejection");
      });
    });

    describe("Cleanup", () => {
      it("should not leave hanging timeouts on resolution", async () => {
        const timeoutSpy = jest.spyOn(global, "setTimeout");
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

        await thenOrTimeout(delay(50), { timeoutMs: 200 });

        expect(clearTimeoutSpy).toHaveBeenCalled();
        expect(timeoutSpy).toHaveBeenCalledTimes(2); // One for delay, one for timeout

        timeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
      });

      it("should not leave hanging timeouts on rejection", async () => {
        const timeoutSpy = jest.spyOn(global, "setTimeout");
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

        await expect(
          thenOrTimeout(delayedReject(50), { timeoutMs: 200 }),
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
        expect(Date.now() - start).toBeLessThan(200); // Should complete concurrently
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
