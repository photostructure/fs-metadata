// src/error.ts

import { isNumber } from "./number";
import { compactValues, map, omit } from "./object";
import { isBlank, isNotBlank } from "./string";

function toMessage(context: string, cause: unknown): string {
  const causeStr =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : cause
          ? JSON.stringify(cause)
          : "";
  return context + (isBlank(causeStr) ? "" : ": " + causeStr);
}

export class WrappedError extends Error {
  errno?: number;
  code?: string;
  syscall?: string;
  path?: string;
  constructor(
    context: string,
    options?: {
      name?: string;
      cause?: unknown;
      errno?: number;
      code?: string;
      syscall?: string;
      path?: string;
    },
  ) {
    super(toMessage(context, options?.cause));

    const cause = map(options?.cause, toError);
    const opts = { ...compactValues(cause), ...compactValues(options) };

    if (isNotBlank(options?.name)) {
      this.name = options.name;
    }

    if (cause != null) {
      this.cause = cause;
      if (cause instanceof Error) {
        this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
      }
    }

    if (isNumber(opts.errno)) {
      this.errno = opts.errno;
    }
    if (isNotBlank(opts.code)) {
      this.code = opts.code;
    }
    if (isNotBlank(opts.syscall)) {
      this.syscall = opts.syscall;
    }
    if (isNotBlank(options?.path)) {
      this.path = options.path;
    }
  }

  get details(): Record<string, unknown> {
    return compactValues(omit(this, "name", "message", "cause"));
  }

  override toString(): string {
    const details = this.details;
    const detailsStr =
      Object.keys(details).length === 0 ? "" : " " + JSON.stringify(details);
    return `${super.toString()}${detailsStr}`;
  }
}

export function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
