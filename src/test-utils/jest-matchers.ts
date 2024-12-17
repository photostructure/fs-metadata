/* eslint-disable @typescript-eslint/no-namespace */
import { expect } from "@jest/globals";

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeWithinDelta(expected: number, delta: number): R;
    }
  }
}

function toBeWithinDelta(received: number, expected: number, delta: number) {
  const pass = Math.abs(received - expected) <= delta;
  if (pass) {
    return {
      message: () =>
        `expected ${received} not to be within ${delta} of ${expected}`,
      pass: true,
    };
  } else {
    return {
      message: () =>
        `expected ${received} to be within ${delta} of ${expected}`,
      pass: false,
    };
  }
}

expect.extend({ toBeWithinDelta });