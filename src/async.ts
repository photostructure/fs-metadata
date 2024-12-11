import { availableParallelism } from "node:os";
import { env } from "node:process";
import { debug, isDebugEnabled } from "./debuglog.js";
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
      Error.captureStackTrace(this, withTimeout);
    }
  }
}
/**
 * Rejects the promise with a TimeoutError if it does not resolve within the
 * specified time.
 *
 * @param promise The promise to wrap.
 * @param timeoutMs The timeout in milliseconds. Timeouts are disabled if this is 0.
 * @returns A promise that resolves when the input promise resolves, or rejects
 * with a TimeoutError if the input promise does not resolve within the
 * specified time.
 * @throws {TimeoutError} if the input promise does not resolve within the
 * specified time.
 * @throws {TypeError} if timeoutMs is not a number that is greater than 0.
 */
export function withTimeout<T>(opts: {
  promise: Promise<T>;
  timeoutMs: number;
  desc?: string;
}): Promise<T> {
  const start = Date.now();
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
    return opts.promise;
  }

  if (env["NODE_ENV"] === "test") {
    const ms = toInt(env["TEST_DELAY"]);
    if (gt0(ms)) {
      opts.promise = delay(ms).then(() => opts.promise);
    }
  }

  let state: undefined | "resolved" | "rejected" | "timed out";
  let timeoutId: NodeJS.Timeout | undefined;

  // Create error with proper stack trace
  const timeoutError = new TimeoutError(
    `${desc}: timeout after ${timeoutMs}ms`,
  );

  /**
   * @return true if `newState` "won", and the caller needs to take
   * responsibility
   */
  const onSettled = (newState: typeof state) => {
    if (state != null) {
      // no-op, already settled
      return false;
    }
    state = newState;
    if (isDebugEnabled()) {
      debug("[thenOrTimeout] %s: %s in %d ms", desc, state, Date.now() - start);
    }
    if (timeoutId != null) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    return true;
  };

  const wrappedPromise = opts.promise.then(
    (result) => {
      onSettled("resolved");
      return result;
    },
    (error) => {
      // only throw if we haven't already settled
      if (onSettled("rejected")) throw error;
    },
  ) as Promise<T>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (onSettled("timed out")) {
        reject(timeoutError);
      }
    }, timeoutMs);
  });

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
