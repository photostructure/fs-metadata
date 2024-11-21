// src/object.js

/**
 * Check if a value is an object
 */
export function isObject(value: unknown): value is object {
  // typeof null is 'object', so we need to check for that case YAY JAVASCRIPT
  return typeof value === "object" && value != null && !Array.isArray(value);
}

/**
 * Omit the specified fields from an object
 */
export function omit<T extends object, K extends keyof T>(
  obj: T,
  ...keys: K[]
): Omit<T, K> {
  const copy = { ...obj };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
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

export function compactValues(obj: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj ?? {})) {
    if (value != null) {
      result[key] = value;
    }
  }
  return result;
}
