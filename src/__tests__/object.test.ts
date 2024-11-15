// src/__tests__/object.test.ts

import { omit, pick } from "../object.js";

describe("omit", () => {
  it("should remove specified fields from an object", () => {
    const input = {
      name: "John",
      age: 30,
      email: "john@example.com",
      address: "123 Main St",
    };

    const result = omit(input, "age", "email");

    expect(result).toEqual({
      name: "John",
      address: "123 Main St",
    });
  });

  it("should handle empty keys array", () => {
    const input = { name: "John", age: 30 };
    const result = omit(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input); // Should be a new object
  });

  it("should handle non-existent keys", () => {
    const input = { name: "John", age: 30 };
    const result = omit(input, "email" as keyof typeof input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });

  it("should handle objects with nested properties", () => {
    const input = {
      name: "John",
      details: {
        age: 30,
        address: "123 Main St",
      },
    };

    const result = omit(input, "details");
    expect(result).toEqual({ name: "John" });
    expect(result).not.toBe(input);
  });

  it("should preserve object property order", () => {
    const input = {
      a: 1,
      b: 2,
      c: 3,
      d: 4,
    };

    const result = omit(input, "b", "d");
    const keys = Object.keys(result);
    expect(keys).toEqual(["a", "c"]);
  });
});

describe("pick", () => {
  it("should select specified fields from an object", () => {
    const input = {
      name: "John",
      age: 30,
      email: "john@example.com",
      address: "123 Main St",
    };

    const result = pick(input, "name", "email");

    expect(result).toEqual({
      name: "John",
      email: "john@example.com",
    });
  });

  it("should handle empty keys array", () => {
    const input = { name: "John", age: 30 };
    const result = pick(input);
    expect(result).toEqual({});
  });

  it("should handle non-existent keys", () => {
    const input = { name: "John", age: 30 };
    const result = pick(input, "email" as keyof typeof input);
    expect(result).toEqual({
      email: undefined,
    });
  });

  it("should handle objects with nested properties", () => {
    const input = {
      name: "John",
      details: {
        age: 30,
        address: "123 Main St",
      },
    };

    const result = pick(input, "details");
    expect(result).toEqual({
      details: {
        age: 30,
        address: "123 Main St",
      },
    });
  });

  it("should preserve object property order", () => {
    const input = {
      a: 1,
      b: 2,
      c: 3,
      d: 4,
    };

    const result = pick(input, "c", "a");
    const keys = Object.keys(result);
    expect(keys).toEqual(["c", "a"]);
  });

  it("should handle objects with undefined and null values", () => {
    const input = {
      name: "John",
      age: undefined,
      email: null,
    };

    const result = pick(input, "name", "age", "email");
    expect(result).toEqual({
      name: "John",
      age: undefined,
      email: null,
    });
  });
});
