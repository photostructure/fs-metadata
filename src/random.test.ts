// src/random.test.ts

import { times } from "./array.js";
import { pickRandom, randomLetter, randomLetters, shuffle } from "./random.js";

describe("random", () => {
  describe("randomLetter", () => {
    it("should return a single character between 'a' and 'z'", () => {
      const letter = randomLetter();
      expect(letter).toMatch(/^[a-z]$/);
    });
  });

  describe("randomLetters", () => {
    it("should return a string of the specified length", () => {
      const length = 10;
      const letters = randomLetters(length);
      expect(letters).toHaveLength(length);
    });

    it("should return a string containing only characters between 'a' and 'z'", () => {
      const letters = randomLetters(100);
      expect(letters).toMatch(/^[a-z]+$/);
    });
  });

  describe("shuffle", () => {
    it("should return a shuffled array", () => {
      const array = times(10, (i) => i);
      const shuffled = shuffle(array);
      expect(shuffled).not.toEqual(array);
      expect(shuffled.sort()).toEqual(array.sort());
    });

    it("should not modify the original array", () => {
      const array = times(10, (i) => i);
      const expected = [...array];
      shuffle(array);
      expect(array).toEqual(expected);
    });
  });

  describe("pickRandom", () => {
    it("should return an element from the array", () => {
      const array = [1, 2, 3, 4, 5];
      const element = pickRandom(array);
      expect(array).toContain(element);
    });

    it("should return undefined for an empty array", () => {
      const array: number[] = [];
      expect(() => pickRandom(array)).toThrow(
        "Cannot pick from an empty array",
      );
    });
  });
});
