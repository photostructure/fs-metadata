// src/defer.test.ts

import { defer } from "./defer";

describe("defer", () => {
  it("should compute value only on first access", () => {
    let callCount = 0;
    const deferred = defer(() => {
      callCount++;
      return "test";
    });

    expect(callCount).toBe(0);
    expect(deferred()).toBe("test");
    expect(callCount).toBe(1);
    expect(deferred()).toBe("test");
    expect(callCount).toBe(1);
  });

  it("should allow resetting the cached value", () => {
    let value = 1;
    const deferred = defer(() => value++);

    expect(deferred()).toBe(1);
    expect(deferred()).toBe(1);

    deferred.reset();
    expect(deferred()).toBe(2);
    expect(deferred()).toBe(2);
  });

  it("should handle null and undefined values", () => {
    const nullDefer = defer(() => null);
    const undefinedDefer = defer(() => undefined);

    expect(nullDefer()).toBeNull();
    expect(undefinedDefer()).toBeUndefined();
  });

  it("should maintain separate caches for different instances", () => {
    const defer1 = defer(() => "one");
    const defer2 = defer(() => "two");

    expect(defer1()).toBe("one");
    expect(defer2()).toBe("two");

    defer1.reset();
    expect(defer2()).toBe("two");
  });

  it("should handle error cases", () => {
    const errorDefer = defer(() => {
      throw new Error("test error");
    });

    expect(() => errorDefer()).toThrow("test error");
  });

  it("should work with complex objects", () => {
    const obj = { foo: "bar" };
    const deferred = defer(() => obj);

    expect(deferred()).toBe(obj);
    expect(deferred()).toEqual({ foo: "bar" });
  });

  it("should handle async functions correctly", async () => {
    const deferred = defer(() => Promise.resolve("async value"));
    const result = await deferred();
    expect(result).toBe("async value");
  });

  it("should preserve function context", () => {
    class Test {
      value = "test";
      deferred = defer(() => this.value);
    }

    expect(new Test().deferred()).toBe("test");
  });
});
