// src/Array.ts

export async function asyncFilter<T>(
  arr: T[],
  predicate: (item: T) => Promise<boolean>,
): Promise<T[]> {
  const results = await Promise.all(arr.map(predicate));
  return arr.filter((_item, index) => results[index]);
}

/**
 * Remove duplicate elements from an array. Primitive values are compared using
 * strict equality. Objects and arrays are compared by reference.
 *
 * @return A new array with duplicate elements removed
 */
export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
