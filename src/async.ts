import { isNumber } from "./number.js";
import { blank } from "./string.js";

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
  let timeoutId: NodeJS.Timeout;

  const desc = blank(opts.desc) ? "thenOrTimeout()" : opts.desc;

  if (!isNumber(opts.timeoutMs)) {
    throw new TypeError(
      desc +
        ": Expected timeoutMs to be > 0, but got " +
        typeof opts.timeoutMs +
        ": " +
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
  const timeoutAt = Date.now() + timeoutMs;

  // By creating the error here, we can capture the stack trace up to the caller
  const err = new TimeoutError(`${desc}: timeout after ${timeoutMs}ms`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(err), timeoutMs);
  });

  return Promise.race([
    promise
      .then((result) => {
        // if the event loop is blocked the timeout may have been starved. This
        // should only happen in extreme cases and tests.
        if (Date.now() >= timeoutAt) {
          throw err;
        } else {
          return result;
        }
      })
      .finally(() => clearTimeout(timeoutId)),
    timeoutPromise,
  ]);
}

/**
 * Delay for the specified number of milliseconds.
 *
 * @param ms The number of milliseconds to delay
 */
export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
