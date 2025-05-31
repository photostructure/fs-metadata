// src/array.test.ts

import { compact, times, uniq, uniqBy } from "./array";

describe("Array", () => {
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

    it("should handle null values from key function", () => {
      const objects = [
        { id: 1, name: "Alice" },
        { id: null, name: "Bob" },
        { id: 2, name: "Charlie" },
        { id: undefined, name: "David" },
      ];
      const result = uniqBy(objects, (item) => item.id);
      expect(result).toEqual([
        { id: 1, name: "Alice" },
        { id: 2, name: "Charlie" },
      ]);
    });

    it("should handle undefined returned from key function", () => {
      const objects = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const result = uniqBy(objects, (item) =>
        item.id > 1 ? item.id : undefined,
      );
      expect(result).toEqual([{ id: 2 }, { id: 3 }]);
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

    it("should handle null input", () => {
      // Testing the null branch of arr == null check
      const nullInput: Parameters<typeof compact>[0] = null as never;
      expect(compact(nullInput)).toEqual([]);
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
