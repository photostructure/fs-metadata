// src/__tests__/async.test.ts

import { jest } from "@jest/globals";
import { thenOrTimeout, TimeoutError } from "../async.js";

describe("async", () => {
  describe("thenOrTimeout", () => {
    // Helper function to create a promise that resolves after a delay
    const delay = (ms: number): Promise<string> =>
      new Promise((resolve) => setTimeout(() => resolve("success"), ms));

    // Helper function to create a promise that rejects after a delay
    const delayedReject = (ms: number): Promise<never> =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("failed")), ms),
      );

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

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
        const promise = delay(50);
        const wrappedPromise = thenOrTimeout(promise, { timeoutMs: 100 });

        jest.advanceTimersByTime(50);
        await expect(wrappedPromise).resolves.toBe("success");
      });

      it("should handle immediate resolution", async () => {
        const promise = Promise.resolve("instant");
        await expect(thenOrTimeout(promise, { timeoutMs: 100 })).resolves.toBe(
          "instant",
        );
      });

      it("should handle immediate rejection", async () => {
        const promise = Promise.reject(new Error("instant failure"));
        await expect(
          thenOrTimeout(promise, { timeoutMs: 100 }),
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
          const promise = Promise.resolve(value);
          await expect(
            thenOrTimeout(promise, { timeoutMs: 100 }),
          ).resolves.toBe(value);
        }
      });
    });

    describe("Timeout behavior", () => {
      it("should reject with TimeoutError when promise exceeds timeout", async () => {
        const promise = delay(200);
        const wrappedPromise = thenOrTimeout(promise, { timeoutMs: 100 });

        jest.advanceTimersByTime(100);
        await expect(wrappedPromise).rejects.toThrow(TimeoutError);
        await expect(wrappedPromise).rejects.toThrow(/timeout after 100ms/);
      });

      it("should clear timeout when promise resolves", async () => {
        const promise = delay(50);
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

        const wrappedPromise = thenOrTimeout(promise, { timeoutMs: 100 });
        jest.advanceTimersByTime(50);

        await wrappedPromise;
        expect(clearTimeoutSpy).toHaveBeenCalled();

        clearTimeoutSpy.mockRestore();
      });

      it("should clear timeout when promise rejects", async () => {
        const promise = delayedReject(50);
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

        const wrappedPromise = thenOrTimeout(promise, { timeoutMs: 100 });
        jest.advanceTimersByTime(50);

        await expect(wrappedPromise).rejects.toThrow("failed");
        expect(clearTimeoutSpy).toHaveBeenCalled();

        clearTimeoutSpy.mockRestore();
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
        // Create a promise that never settles
        const neverSettle = new Promise(() => {});
        const wrappedPromise = thenOrTimeout(neverSettle, { timeoutMs: 100 });

        jest.advanceTimersByTime(100);
        await expect(wrappedPromise).rejects.toThrow(TimeoutError);
      });

      it("should handle promises with no error handler", async () => {
        const promise = delayedReject(50);
        const wrappedPromise = thenOrTimeout(promise, { timeoutMs: 100 });

        jest.advanceTimersByTime(50);
        await expect(wrappedPromise).rejects.toThrow("failed");
      });
    });

    describe("Cleanup", () => {
      it("should not leave hanging timeouts on resolution", async () => {
        const timeoutSpy = jest.spyOn(global, "setTimeout");
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

        const promise = delay(50);
        const wrappedPromise = thenOrTimeout(promise, { timeoutMs: 100 });

        jest.advanceTimersByTime(50);
        await wrappedPromise;

        expect(timeoutSpy).toHaveBeenCalledTimes(2); // One for delay, one for timeout
        expect(clearTimeoutSpy).toHaveBeenCalled();

        timeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
      });

      it("should not leave hanging timeouts on rejection", async () => {
        const timeoutSpy = jest.spyOn(global, "setTimeout");
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

        const promise = delayedReject(50);
        const wrappedPromise = thenOrTimeout(promise, { timeoutMs: 100 });

        jest.advanceTimersByTime(50);
        await expect(wrappedPromise).rejects.toThrow();

        expect(timeoutSpy).toHaveBeenCalledTimes(2); // One for delayedReject, one for timeout
        expect(clearTimeoutSpy).toHaveBeenCalled();

        timeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
      });
    });
  });
});
