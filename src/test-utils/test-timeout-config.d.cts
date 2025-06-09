/**
 * Get timing multiplier for the current environment
 * @returns {number}
 */
export declare function getTimingMultiplier(): number;

/**
 * Get appropriate test timeout for the current environment.
 *
 * Timeouts are adjusted based on:
 * - CI vs local development
 * - Operating system (Windows is slow with process forking)
 * - Architecture (ARM64 emulation is very slow)
 * - Container environment (Alpine Linux needs more time)
 *
 * @param {number} [baseTimeout] - Base timeout in milliseconds (default: 10000)
 * @returns {number} Timeout in milliseconds
 */
export declare function getTestTimeout(baseTimeout?: number): number;
