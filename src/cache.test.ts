// src/cache.test.ts

import { jest } from "@jest/globals";
import { ttlCache } from "./cache.js";

describe("ttlCache", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should cache function results", () => {
    let executionCount = 0;
    const fn = (x: number) => {
      executionCount++;
      return x * 2;
    };

    const cachedFn = ttlCache(fn, 1000);

    expect(cachedFn(5)).toBe(10);
    expect(cachedFn(5)).toBe(10);
    expect(executionCount).toBe(1);
  });

  it("should handle different arguments separately", () => {
    let executionCount = 0;
    const fn = (x: number) => {
      executionCount++;
      return x * 2;
    };

    const cachedFn = ttlCache(fn, 1000);

    expect(cachedFn(5)).toBe(10);
    expect(cachedFn(6)).toBe(12);
    expect(executionCount).toBe(2);
  });

  it("should expire cache entries after TTL", () => {
    let executionCount = 0;
    const fn = (x: number) => {
      executionCount++;
      return x * 2;
    };

    const cachedFn = ttlCache(fn, 1000);

    expect(cachedFn(5)).toBe(10);
    expect(executionCount).toBe(1);

    jest.advanceTimersByTime(1100);

    expect(cachedFn(5)).toBe(10);
    expect(executionCount).toBe(2);
  });

  it("should handle complex arguments", () => {
    const fn = (obj: { x: number; y: string }) => `${obj.x}-${obj.y}`;
    const cachedFn = ttlCache(fn, 1000);

    expect(cachedFn({ x: 1, y: "test" })).toBe("1-test");
    expect(cachedFn({ x: 1, y: "test" })).toBe("1-test");
  });

  it("should handle zero TTL", () => {
    let executionCount = 0;
    const fn = (x: number) => {
      executionCount++;
      return x * 2;
    };

    const cachedFn = ttlCache(fn, 0);

    expect(cachedFn(5)).toBe(10);
    jest.advanceTimersByTime(1);
    expect(cachedFn(5)).toBe(10);
    expect(executionCount).toBe(2);
  });

  it("should handle multiple concurrent cache entries", () => {
    let executionCount = 0;
    const fn = (x: number) => {
      executionCount++;
      return x * 2;
    };

    const cachedFn = ttlCache(fn, 1000);

    expect(cachedFn(1)).toBe(2);
    expect(cachedFn(2)).toBe(4);
    expect(cachedFn(3)).toBe(6);

    jest.advanceTimersByTime(500);

    expect(cachedFn(1)).toBe(2);
    expect(cachedFn(2)).toBe(4);
    expect(cachedFn(3)).toBe(6);
    expect(executionCount).toBe(3);

    jest.advanceTimersByTime(600);

    expect(cachedFn(1)).toBe(2);
    expect(executionCount).toBe(4);
  });
});
