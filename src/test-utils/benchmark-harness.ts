import { getTimingMultiplier } from "./test-timeout-config";

export interface BenchmarkOptions {
  /**
   * Target duration for the benchmark in milliseconds (default: 20000ms / 20 seconds)
   */
  targetDurationMs?: number;

  /**
   * Maximum timeout for the entire benchmark in milliseconds (default: 60000ms / 1 minute)
   */
  maxTimeoutMs?: number;

  /**
   * Minimum iterations to run regardless of timing (default: 5)
   */
  minIterations?: number;

  /**
   * Maximum iterations to run regardless of timing (default: 10000)
   */
  maxIterations?: number;

  /**
   * Number of warmup iterations before timing (default: 2)
   */
  warmupIterations?: number;

  /**
   * Whether to log debug information (default: false)
   */
  debug?: boolean;
}

export interface BenchmarkResult {
  /**
   * Number of iterations actually performed
   */
  iterations: number;

  /**
   * Total duration in milliseconds
   */
  totalDurationMs: number;

  /**
   * Average duration per iteration in milliseconds
   */
  avgIterationMs: number;

  /**
   * Whether the benchmark hit the timeout
   */
  timedOut: boolean;
}

/**
 * Runs a benchmark operation adaptively based on the performance of the test environment.
 *
 * This harness:
 * 1. Runs warmup iterations to estimate operation time
 * 2. Calculates how many iterations can fit within the target duration
 * 3. Runs the calculated number of iterations with a safety timeout
 *
 * @param operation - The async function to benchmark (should be a single iteration)
 * @param options - Configuration options for the benchmark
 * @returns Results of the benchmark run
 */
export async function runAdaptiveBenchmark(
  operation: () => Promise<void>,
  options: BenchmarkOptions = {},
): Promise<BenchmarkResult> {
  const {
    targetDurationMs = 20_000,
    maxTimeoutMs = 60_000,
    minIterations = 5,
    maxIterations = 10_000,
    warmupIterations = 2,
  } = options;

  // Apply timing multiplier based on environment
  const multiplier = getTimingMultiplier();
  const adjustedTargetMs = targetDurationMs * multiplier;
  const adjustedTimeoutMs = maxTimeoutMs * multiplier;

  // Debug logging removed to prevent 'Cannot log after tests are done' errors

  // Run warmup iterations

  const warmupStart = Date.now();
  for (let i = 0; i < warmupIterations; i++) {
    await operation();
  }
  const warmupDuration = Date.now() - warmupStart;
  const avgWarmupTime = warmupDuration / warmupIterations;

  // Warmup timing debug info removed to prevent console logging issues

  // Calculate target iterations based on warmup timing
  // Add 10% safety margin to avoid overshooting
  const safetyMargin = 0.9;
  let targetIterations = Math.floor(
    (adjustedTargetMs * safetyMargin) / avgWarmupTime,
  );

  // Clamp to min/max bounds
  targetIterations = Math.max(
    minIterations,
    Math.min(maxIterations, targetIterations),
  );

  // Target iterations debug info removed to prevent console logging issues

  // Set up timeout promise
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<void>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Benchmark timeout after ${adjustedTimeoutMs}ms`));
    }, adjustedTimeoutMs);
  });

  // Run the actual benchmark
  const benchmarkStart = Date.now();
  let completedIterations = 0;
  let timedOut = false;

  try {
    // Run iterations with timeout protection
    await Promise.race([
      (async () => {
        for (let i = 0; i < targetIterations; i++) {
          await operation();
          completedIterations++;

          // Check if we're approaching the timeout
          const elapsed = Date.now() - benchmarkStart;
          if (elapsed > adjustedTimeoutMs * 0.95) {
            // Approaching timeout - stopping early
            break;
          }
        }
      })(),
      timeoutPromise,
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("timeout")) {
      timedOut = true;
      // Benchmark timed out
    } else {
      throw error;
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  const totalDuration = Date.now() - benchmarkStart;
  const avgIterationTime = totalDuration / completedIterations;

  const result: BenchmarkResult = {
    iterations: completedIterations,
    totalDurationMs: totalDuration,
    avgIterationMs: avgIterationTime,
    timedOut,
  };

  // Benchmark results debug info removed to prevent console logging issues

  return result;
}

/**
 * Helper function to run an operation with adaptive iterations and a callback.
 * This is useful for tests that need to process results after each iteration.
 *
 * @param operation - The async function that returns a value
 * @param callback - Function to process each result
 * @param options - Configuration options for the benchmark
 */
export async function runAdaptiveBenchmarkWithCallback<T>(
  operation: () => Promise<T>,
  callback: (result: T, iteration: number) => void | Promise<void>,
  options: BenchmarkOptions = {},
): Promise<BenchmarkResult> {
  let iterationCount = 0;

  const wrappedOperation = async () => {
    const result = await operation();
    await callback(result, iterationCount++);
  };

  return runAdaptiveBenchmark(wrappedOperation, options);
}
