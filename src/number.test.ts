// src/number.test.ts

import { gt0, gte0, isNumber, lte, toGt0, toGte0, toInt } from "./number.js";

describe("number", () => {
  describe("isNumber", () => {
    it("returns true for finite numbers", () => {
      expect(isNumber(123)).toBe(true);
      expect(isNumber(0)).toBe(true);
      expect(isNumber(-123)).toBe(true);
    });

    it("returns false for non-numbers", () => {
      expect(isNumber("123")).toBe(false);
      expect(isNumber(null)).toBe(false);
      expect(isNumber(undefined)).toBe(false);
      expect(isNumber(NaN)).toBe(false);
      expect(isNumber(Infinity)).toBe(false);
    });
  });

  describe("toInt", () => {
    it("converts valid number strings to integers", () => {
      expect(toInt("123")).toBe(123);
      expect(toInt("0")).toBe(0);
      expect(toInt("-123")).toBe(-123);
    });

    it("returns undefined for invalid number strings", () => {
      expect(toInt("abc")).toBeUndefined();
      expect(toInt("123.456")).toBeUndefined();
      expect(toInt("123abc")).toBeUndefined();
      expect(toInt(null)).toBeUndefined();
      expect(toInt(undefined)).toBeUndefined();
    });
  });

  describe("gt0", () => {
    it("returns true for numbers greater than 0", () => {
      expect(gt0(1)).toBe(true);
      expect(gt0(123)).toBe(true);
    });

    it("returns false for numbers less than or equal to 0", () => {
      expect(gt0(0)).toBe(false);
      expect(gt0(-1)).toBe(false);
    });

    it("returns false for non-numbers", () => {
      expect(gt0("1")).toBe(false);
      expect(gt0(null)).toBe(false);
      expect(gt0(undefined)).toBe(false);
    });
  });

  describe("gte0", () => {
    it("returns true for numbers greater than or equal to 0", () => {
      expect(gte0(0)).toBe(true);
      expect(gte0(1)).toBe(true);
      expect(gte0(123)).toBe(true);
    });

    it("returns false for numbers less than 0", () => {
      expect(gte0(-1)).toBe(false);
    });

    it("returns false for non-numbers", () => {
      expect(gte0("1")).toBe(false);
      expect(gte0(null)).toBe(false);
      expect(gte0(undefined)).toBe(false);
    });
  });

  describe("toGt0", () => {
    it("returns the number if it is greater than 0", () => {
      expect(toGt0(1)).toBe(1);
      expect(toGt0(123)).toBe(123);
    });

    it("returns undefined for numbers less than or equal to 0", () => {
      expect(toGt0(0)).toBeUndefined();
      expect(toGt0(-1)).toBeUndefined();
    });

    it("returns undefined for non-numbers", () => {
      expect(toGt0("1")).toBeUndefined();
      expect(toGt0(null)).toBeUndefined();
      expect(toGt0(undefined)).toBeUndefined();
    });
  });

  describe("lte", () => {
    it("returns true if the first number is less than or equal to the second number", () => {
      expect(lte(1, 2)).toBe(true);
      expect(lte(2, 2)).toBe(true);
      expect(lte(0, 1)).toBe(true);
    });

    it("returns false if the first number is greater than the second number", () => {
      expect(lte(2, 1)).toBe(false);
      expect(lte(3, 2)).toBe(false);
    });

    it("returns false if either value is not a number", () => {
      expect(lte(1, undefined)).toBe(false);
      expect(lte(undefined, 1)).toBe(false);
      expect(lte(undefined, undefined)).toBe(false);
    });
  });
  describe("toGte0", () => {
    it("returns the number if it is greater than or equal to 0", () => {
      expect(toGte0(0)).toBe(0);
      expect(toGte0(1)).toBe(1);
      expect(toGte0(123)).toBe(123);
      expect(toGte0(0.5)).toBe(0.5);
    });

    it("returns undefined for numbers less than 0", () => {
      expect(toGte0(-1)).toBeUndefined();
      expect(toGte0(-123)).toBeUndefined();
      expect(toGte0(-0.5)).toBeUndefined();
    });

    it("returns undefined for non-numbers", () => {
      expect(toGte0("0")).toBeUndefined();
      expect(toGte0("1")).toBeUndefined();
      expect(toGte0([])).toBeUndefined();
      expect(toGte0({})).toBeUndefined();
      expect(toGte0(null)).toBeUndefined();
      expect(toGte0(undefined)).toBeUndefined();
    });
  });
});
