// src/__tests__/Array.test.ts

import { asyncFilter, uniq } from "../Array";

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
      const delays = [30, 20, 10];
      const start = Date.now();

      await asyncFilter(delays, async (delay) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return true;
      });

      const totalTime = Date.now() - start;

      // Should take approximately the time of the longest delay (30ms)
      // Adding some buffer for execution time
      expect(totalTime).toBeLessThan(50);
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
      const result = uniq(numbers);
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    // Test with an array of strings
    it("should return unique strings", () => {
      const strings = ["a", "b", "b", "c", "a"];
      const result = uniq(strings);
      expect(result).toEqual(["a", "b", "c"]);
    });

    // Test with an empty array
    it("should return an empty array when input is empty", () => {
      const emptyArray: any[] = [];
      const result = uniq(emptyArray);
      expect(result).toEqual([]);
    });

    // Test with an array of objects
    it("should return unique objects based on reference", () => {
      const obj1 = { id: 1 };
      const obj2 = { id: 2 };
      const obj3 = obj1;
      const objects = [obj1, obj2, obj3];
      const result = uniq(objects);
      expect(result).toEqual([obj1, obj2]);
    });

    // Test with mixed types
    it("should return unique values for mixed types", () => {
      const mixedArray = [1, "a", 1, "b", "a"];
      const result = uniq(mixedArray);
      expect(result).toEqual([1, "a", "b"]);
    });
  });
});
