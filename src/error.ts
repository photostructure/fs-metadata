export class WrappedError extends Error {
  constructor(
    context: string,
    public readonly cause: unknown,
  ) {
    const errorMessage = cause instanceof Error ? cause.message : String(cause);
    super(`${context}\nCause: ${errorMessage}`);

    if (cause instanceof Error) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}
