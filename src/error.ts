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
