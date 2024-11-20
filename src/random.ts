// src/random.ts

import { randomInt } from "node:crypto";

const CharCode_a = "a".charCodeAt(0);
/**
 * @return a random character `[a-z]`
 */
export function randomChar(): string {
  return String.fromCharCode(CharCode_a + randomInt(0, 26));
}

/**
 * Shuffle an array in place using the Fisher-Yates (Knuth) algorithm.
 * @param a The array to shuffle
 * @returns The same array, shuffled in place
 */
export function shuffle<T>(a: T[]): T[] {
  if (a.length <= 1) return a;
  for (let i = a.length - 1; i > 0; i--) {
    // Pick a random index from 0 to i
    const j = Math.floor(Math.random() * (i + 1));
    // Swap elements at indices i and j
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
