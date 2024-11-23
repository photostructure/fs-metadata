// src/__tests__/array.test.ts

import { jest } from "@jest/globals";
import { asyncFilter, times, uniq, uniqBy } from "../array.js";

describe("Array", () => {
  describe("asyncFilter", () => {
    // Test empty array
    it("should return empty array when input is empty", async () => {
      const result = await asyncFilter([], async () => true);
      expect(result).toEqual([]);
    });

    // Test filtering numbers
    it("should filter numbers based on async predicate", async () => {
      const numbers = [1, 2, 3, 4, 5];
      const isEvenAsync = async (num: number) => {
        await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate async operation
        return num % 2 === 0;
      };

      const result = await asyncFilter(numbers, isEvenAsync);
      expect(result).toEqual([2, 4]);
    });

    // Test filtering objects
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

    // Test with predicate that always returns true
    it("should return all elements when predicate always returns true", async () => {
      const input = ["a", "b", "c"];
      const result = await asyncFilter(input, async () => true);
      expect(result).toEqual(input);
    });

    // Test with predicate that always returns false
    it("should return empty array when predicate always returns false", async () => {
      const input = ["a", "b", "c"];
      const result = await asyncFilter(input, async () => false);
      expect(result).toEqual([]);
    });

    // Test concurrent execution
    it("should execute predicates concurrently", async () => {
      jest.retryTimes(3);
      const delays = [50, 40, 30, 20, 10];
      const start = Date.now();

      const results = await asyncFilter(delays, async (delay) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return true;
      });

      expect(results).toEqual(delays);

      const totalTime = Date.now() - start;

      // Should take approximately the time of the longest delay (50ms)
      // Adding some buffer for execution time
      expect(totalTime).toBeLessThan(140); // slow GHA runner took 121ms (!!)
    });

    // Test error handling
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

    // Test with mixed types using generics
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
    // Test with an array of numbers
    it("should return unique numbers", () => {
      const numbers = [1, 2, 2, 3, 4, 4, 5];
      expect(uniq(numbers)).toEqual([1, 2, 3, 4, 5]);
    });

    // Test with an array of strings
    it("should return unique strings", () => {
      const strings = ["a", "b", "b", "c", "a"];
      expect(uniq(strings)).toEqual(["a", "b", "c"]);
    });

    // Test with an empty array
    it("should return an empty array when input is empty", () => {
      expect(uniq([])).toEqual([]);
    });

    // Test with an array of objects
    it("should return unique objects based on reference", () => {
      const obj1 = { id: 1 };
      const obj2 = { id: 2 };
      const obj3 = obj1;
      const objects = [obj1, obj2, obj3];
      expect(uniq(objects)).toEqual([obj1, obj2]);
    });

    // Test with mixed types
    it("should return unique values for mixed types", () => {
      const mixedArray = [1, "a", 1, "b", "a"];
      expect(uniq(mixedArray)).toEqual([1, "a", "b"]);
    });
  });

  // Tests for uniqBy function
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

  // Tests for times function
  describe("times", () => {
    it("should create an array of specified length with given value", () => {
      const result = times(5, () => 42);
      expect(result).toEqual([42, 42, 42, 42, 42]);
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
});
