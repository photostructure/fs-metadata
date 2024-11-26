// src/error.ts

export class WrappedError extends Error {
  constructor(context: string, cause: unknown) {
    const errorMessage = cause instanceof Error ? cause.message : String(cause);
    super(`${context}: ${errorMessage}`);
    this.cause = cause;

    if (cause instanceof Error) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

export function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
