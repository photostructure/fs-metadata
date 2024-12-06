import { availableParallelism } from "node:os";
import { env } from "node:process";
import { defer } from "./defer.js";
import { gt0, isNumber, toInt } from "./number.js";
import { isBlank } from "./string.js";

/**
 * An error that is thrown when a promise does not resolve within the specified
 * time.
 */
export class TimeoutError extends Error {
  constructor(message: string, captureStackTrace = true) {
    super(message);
    this.name = "TimeoutError";
    // Capture the stack trace up to the calling site
    if (captureStackTrace && Error.captureStackTrace) {
      Error.captureStackTrace(this, thenOrTimeout);
    }
  }
}
/**
 * Rejects the promise with a TimeoutError if it does not resolve within the
 * specified time.
 *
 * @param promise The promise
 * @param timeoutMs The timeout in milliseconds. Timeouts are disabled if this is 0.
 * @returns A promise that resolves when the input promise resolves, or rejects
 * with a TimeoutError if the input promise does not resolve within the
 * specified time.
 * @throws {TimeoutError} if the input promise does not resolve within the
 * specified time.
 * @throws {TypeError} if timeoutMs is not a number that is greater than 0.
 */
export function thenOrTimeout<T>(
  promise: Promise<T>,
  opts: {
    timeoutMs: number;
    desc?: string;
  },
): Promise<T> {
  const desc = isBlank(opts.desc) ? "thenOrTimeout()" : opts.desc;

  if (!isNumber(opts.timeoutMs)) {
    throw new TypeError(
      desc +
        ": Expected timeoutMs to be numeric, but got " +
        JSON.stringify(opts.timeoutMs),
    );
  }

  const timeoutMs = Math.floor(opts.timeoutMs);

  if (timeoutMs < 0) {
    throw new TypeError(
      desc + ": Expected timeoutMs to be > 0, but got " + timeoutMs,
    );
  }

  if (timeoutMs === 0) {
    return promise;
  }

  if (env["NODE_ENV"] === "test") {
    const ms = toInt(env["TEST_DELAY"]);
    if (gt0(ms)) {
      promise = delay(ms).then(() => promise);
    }
  }

  let isResolved = false;
  let timeoutId: NodeJS.Timeout;

  // Create error with proper stack trace
  const timeoutError = new TimeoutError(
    `${desc}: timeout after ${timeoutMs}ms`,
  );

  const onSettled = defer(() => {
    isResolved = true;
    clearTimeout(timeoutId);
  });

  const wrappedPromise = promise.then(
    (result) => {
      onSettled();
      return result;
    },
    (error) => {
      onSettled();
      throw error;
    },
  );

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (!isResolved) {
        reject(timeoutError);
      }
    }, timeoutMs);
  });

  // Handle potential unhandled rejection in timeoutPromise
  void timeoutPromise.catch(() => {});

  return Promise.race([wrappedPromise, timeoutPromise]);
}

/**
 * Delay for the specified number of milliseconds.
 *
 * @param ms The number of milliseconds to delay
 * @param t Optional value to resolve with after delay
 * @returns Promise that resolves with the provided value (or void if none provided)
 */
export async function delay<T = void>(ms: number, t?: T): Promise<T> {
  return new Promise<T>((resolve) => setTimeout(() => resolve(t as T), ms));
}

/**
 * Apply `fn` to every item in `items` with a maximum concurrency of
 * `maxConcurrency`.
 */
export async function mapConcurrent<I, O>({
  items,
  fn,
  maxConcurrency = availableParallelism(),
}: {
  items: I[];
  fn: (t: I) => Promise<O>;
  maxConcurrency?: number;
}): Promise<(O | Error)[]> {
  // Validate maxConcurrency
  if (!gt0(maxConcurrency)) {
    throw new Error(
      `maxConcurrency must be a positive integer, got: ${maxConcurrency}`,
    );
  }

  if (typeof fn !== "function") {
    throw new TypeError(`fn must be a function, got: ${typeof fn}`);
  }

  const results: Promise<O | Error>[] = [];
  const executing: Set<Promise<void>> = new Set();

  for (const [index, item] of items.entries()) {
    // Create a wrapped promise that handles cleanup
    while (executing.size >= maxConcurrency) {
      await Promise.race(executing);
    }
    const p = (results[index] = fn(item).catch((error) => error));
    executing.add(p);
    p.finally(() => executing.delete(p));
  }

  return Promise.all(results);
}
