// src/array.ts

/**
 * Remove duplicate elements from an array.
 *
 * - Primitive values are compared using strict equality.
 * - Objects and arrays are compared by reference.
 *
 * @return A new array with duplicate elements removed
 */
export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/**
 * Remove duplicate elements from an array based on a key function.
 * @param keyFn A function that returns a key for each element. Elements that
 * the key function returns nullish will be removed from the returned array.
 * @return a new array omitting duplicate elements based on a key function.
 */
export function uniqBy<T, K>(arr: T[], keyFn: (item: T) => K | undefined): T[] {
  const seen = new Set<K>();
  return arr.filter((item) => {
    const key = keyFn(item);
    if (key == null || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @return an array of specified length, with each element created by calling
 * the provided function.
 */
export function times<T>(length: number, fn: (index: number) => T): T[] {
  return Array.from({ length }, (_, i) => fn(i));
}

/**
 * @return a new array with elements that are not `null` or `undefined`.
 */
export function compact<T>(arr: (T | null | undefined)[] | undefined): T[] {
  return arr == null ? [] : arr.filter((ea): ea is T => ea != null);
}
