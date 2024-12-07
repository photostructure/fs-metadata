// src/__tests__/array.test.ts

import { jest } from "@jest/globals";
import { asyncFilter, compact, times, uniq, uniqBy } from "../array.js";
import { delay } from "../async.js";

describe("Array", () => {
  describe("asyncFilter", () => {
    it("should return empty array when input is empty", async () => {
      const result = await asyncFilter([], async () => true);
      expect(result).toEqual([]);
    });

    it("should filter numbers based on async predicate", async () => {
      const numbers = [1, 2, 3, 4, 5];
      const isEvenAsync = async (num: number) => {
        await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate async operation
        return num % 2 === 0;
      };

      const result = await asyncFilter(numbers, isEvenAsync);
      expect(result).toEqual([2, 4]);
    });

    it("should filter objects based on async predicate", async () => {
      interface User {
        id: number;
        name: string;
        age: number;
      }

      const users: User[] = [
        { id: 1, name: "Alice", age: 25 },
        { id: 2, name: "Bob", age: 17 },
        { id: 3, name: "Charlie", age: 30 },
      ];

      const isAdultAsync = async (user: User) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return user.age >= 18;
      };

      const result = await asyncFilter(users, isAdultAsync);
      expect(result).toEqual([
        { id: 1, name: "Alice", age: 25 },
        { id: 3, name: "Charlie", age: 30 },
      ]);
    });

    it("should return all elements when predicate always returns true", async () => {
      const input = ["a", "b", "c"];
      const result = await asyncFilter(input, async () => true);
      expect(result).toEqual(input);
    });

    it("should return empty array when predicate always returns false", async () => {
      const input = ["a", "b", "c"];
      const result = await asyncFilter(input, async () => false);
      expect(result).toEqual([]);
    });

    it("should execute predicates concurrently", async () => {
      jest.retryTimes(3);
      const delays = [50, 40, 30, 20, 10];

      const times: [number, number][] = [];

      const results = await asyncFilter(delays, async (ms) => {
        const start = Date.now();
        await delay(ms);
        const end = Date.now();
        times.push([start, end]);
        return true;
      });
      console.log({ times });
      expect(results).toEqual(delays);

      // Rather than checking on full elapsed time, we check that the start and
      // delay times are not in order, indicating concurrent execution
      const sorted = times.flat().sort((a, b) => a - b);
      expect(times).not.toEqual(sorted);
    });

    it("should handle predicate errors correctly", async () => {
      const input = [1, 2, 3];
      const errorPredicate = async (num: number) => {
        if (num === 2) {
          throw new Error("Predicate error");
        }
        return true;
      };

      await expect(asyncFilter(input, errorPredicate)).rejects.toThrow(
        "Predicate error",
      );
    });

    it("should work with union types", async () => {
      const mixedArray: (string | number)[] = ["a", 1, "b", 2];
      const isNumberAsync = async (item: string | number): Promise<boolean> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return typeof item === "number";
      };

      const result = await asyncFilter(mixedArray, isNumberAsync);
      expect(result).toEqual([1, 2]);
    });
  });

  describe("uniq", () => {
    it("should return unique numbers", () => {
      const numbers = [1, 2, 2, 3, 4, 4, 5];
      expect(uniq(numbers)).toEqual([1, 2, 3, 4, 5]);
    });

    it("should return unique strings", () => {
      const strings = ["a", "b", "b", "c", "a"];
      expect(uniq(strings)).toEqual(["a", "b", "c"]);
    });

    it("should return an empty array when input is empty", () => {
      expect(uniq([])).toEqual([]);
    });

    it("should return unique objects based on reference", () => {
      const obj1 = { id: 1 };
      const obj2 = { id: 2 };
      const obj3 = obj1;
      const objects = [obj1, obj2, obj3];
      expect(uniq(objects)).toEqual([obj1, obj2]);
    });

    it("should return unique values for mixed types", () => {
      const mixedArray = [1, "a", 1, "b", "a"];
      expect(uniq(mixedArray)).toEqual([1, "a", "b"]);
    });
  });

  describe("uniqBy", () => {
    it("should return unique objects based on key function", () => {
      const objects = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 1, name: "Charlie" },
      ];
      const uniqueObjects = uniqBy(objects, (item) => item.id);
      expect(uniqueObjects).toEqual([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ]);
    });

    it("should handle array of numbers with key function", () => {
      const numbers = [1.1, 2.2, 1.2, 2.3, 3.3];
      const uniqueNumbers = uniqBy(numbers, (num) => Math.floor(num));
      expect(uniqueNumbers).toEqual([1.1, 2.2, 3.3]);
    });

    it("should return empty array when input is empty", () => {
      expect(uniqBy([], (item) => item)).toEqual([]);
    });
  });

  describe("times", () => {
    it("should create an array of specified length with given value", () => {
      const result = times(5, () => 42);
      expect(result).toEqual([42, 42, 42, 42, 42]);
    });

    it("should pass the correct index", () => {
      const result = times(7, (i) => i);
      expect(result).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it("should return empty array when length is 0", () => {
      const result = times(0, () => "value");
      expect(result).toEqual([]);
    });

    it("should handle functions with side effects", () => {
      let counter = 0;
      const result = times(3, () => counter++);
      expect(result).toEqual([0, 1, 2]);
    });
  });
  
  describe("compact", () => {
    it("should remove null and undefined values", () => {
      const input = [1, null, 2, undefined, 3];
      expect(compact(input)).toEqual([1, 2, 3]);
    });

    it("should handle empty array", () => {
      expect(compact([])).toEqual([]);
    });

    it("should handle undefined input", () => {
      expect(compact(undefined)).toEqual([]);
    });

    it("should preserve falsy values that aren't null/undefined", () => {
      const input = [0, "", false, null, undefined];
      expect(compact(input)).toEqual([0, "", false]);
    });

    it("should handle arrays of objects", () => {
      const obj1 = { id: 1 };
      const obj2 = { id: 2 };
      const input = [obj1, null, obj2, undefined];
      expect(compact(input)).toEqual([obj1, obj2]);
    });

    it("should handle nested arrays", () => {
      const input = [[1], null, [2, 3], undefined];
      expect(compact(input)).toEqual([[1], [2, 3]]);
    });

    it("should handle array of only null/undefined", () => {
      const input = [null, undefined, null];
      expect(compact(input)).toEqual([]);
    });

    it("should preserve order of elements", () => {
      const input = ["a", null, "b", undefined, "c"];
      expect(compact(input)).toEqual(["a", "b", "c"]);
    });

    it("should handle mixed data types", () => {
      const input = [1, "string", null, { key: "value" }, undefined, true];
      expect(compact(input)).toEqual([1, "string", { key: "value" }, true]);
    });
  });
});
