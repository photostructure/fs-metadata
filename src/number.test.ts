// src/number.test.ts

import { gt0, isNumber, toInt } from "./number";

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
});
