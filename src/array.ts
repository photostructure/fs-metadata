// src/array.ts

/**
 * @return a new array whose elements return true based on the given `predicate`
 * function.
 */
export async function asyncFilter<T>(
  arr: T[],
  predicate: (item: T) => boolean | Promise<boolean>,
): Promise<T[]> {
  const results = await Promise.all(arr.map(async (ea) => predicate(ea)));
  return arr.filter((_item, index) => results[index]);
}

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
 * @return a new array omitting duplicate elements based on a key function.
 */
export function uniqBy<T, K>(arr: T[], keyFn: (item: T) => K): T[] {
  const seen = new Set<K>();
  return arr.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
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
