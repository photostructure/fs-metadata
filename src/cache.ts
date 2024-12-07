interface CacheEntry<R> {
  r: R;
  t: NodeJS.Timeout;
}

/**
 * Cache the result of a function for a given time-to-live (TTL).
 */
export function ttlCache<Args extends unknown[], R>(
  fn: (...args: Args) => R,
  ttl: number,
): (...args: Args) => R {
  if (ttl <= 0) return fn;

  const cache = new Map<string, CacheEntry<R>>();

  return (...args: Args): R => {
    const key = JSON.stringify(args);
    const entry = cache.get(key);

    if (entry) {
      return entry.r;
    }

    const result = fn(...args);

    const timeoutId = setTimeout(() => {
      const currentEntry = cache.get(key);
      if (currentEntry?.t === timeoutId) {
        cache.delete(key);
      }
    }, ttl);

    cache.set(key, { r: result, t: timeoutId });

    return result;
  };
}
