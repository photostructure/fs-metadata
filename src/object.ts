// src/object.js

import { isNotBlank, isString } from "./string.js";

/**
 * Check if a value is an object
 */
export function isObject(value: unknown): value is object {
  // typeof null is 'object', so we need to check for that case YAY JAVASCRIPT
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Map a value to another value, or undefined if the value is undefined
 */
export function map<T, U>(
  obj: T | undefined,
  fn: (value: T) => U,
): U | undefined {
  return obj == null ? undefined : fn(obj);
}

/**
 * Omit the specified fields from an object
 */
export function omit<T extends object, K extends keyof T>(
  obj: T,
  ...keys: K[]
): Omit<T, K> {
  const result = {} as Omit<T, K>;
  const keysSet = new Set(keys);

  // OH THE TYPING HUGEMANATEE
  for (const key of Object.keys(obj) as Array<keyof Omit<T, K>>) {
    if (!keysSet.has(key as unknown as K)) {
      result[key] = obj[key];
    }
  }

  return result;
}
/**
 * Pick the specified fields from an object
 */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  ...keys: K[]
): Pick<T, K> {
  const copy = {} as Pick<T, K>;
  for (const key of keys) {
    copy[key] = obj[key];
  }
  return copy;
}
export function compactValues<T extends object>(
  obj: T | undefined,
): Partial<T> {
  const result = {} as Partial<T>;
  if (obj == null || !isObject(obj)) return {};
  for (const [key, value] of Object.entries(obj)) {
    // skip blank strings and nullish values:
    if (value != null && (!isString(value) || isNotBlank(value))) {
      result[key as keyof T] = value as T[keyof T];
    }
  }
  return result;
}
