import { EventEmitter } from "node:events";
import { toError } from "./error";
import { isNumber } from "./number";
import { MinuteMs } from "./units";

/** Default delay between subscription polls: one minute. */
export const PollIntervalMsDefault = MinuteMs;

/** Largest delay Node can represent without replacing it with a 1ms timer. */
const MaxTimerDelayMs = 2_147_483_647;

export interface PollingWatcherOptions {
  /** Milliseconds between one completed poll and the start of the next. */
  pollIntervalMs?: number;
  /** Whether the pending poll timer keeps the Node.js event loop alive. */
  persistent?: boolean;
  /** Closes the watcher when aborted. */
  signal?: AbortSignal;
}

/** Public lifecycle and events shared by polling subscriptions. */
export interface PollingSubscription<TSnapshot, TChange> {
  readonly ready: Promise<TSnapshot>;
  readonly lastError: Error | undefined;
  readonly closed: boolean;
  close(): void;
  ref(): this;
  unref(): this;
  hasRef(): boolean;
  on(event: "change", listener: (change: TChange) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  once(event: "change", listener: (change: TChange) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  off(event: "change", listener: (change: TChange) => void): this;
  off(event: "error", listener: (error: Error) => void): this;
}

export interface PollObservation<T> {
  /** Caller-visible observation, which may have a timeout wrapper. */
  value: Promise<T>;
  /** Underlying work. No new poll is scheduled until this settles. */
  settled: Promise<unknown>;
}

export type PollSource<T> = () => PollObservation<T>;

export function validatePollIntervalMs(value: number | undefined): number {
  const pollIntervalMs = value ?? PollIntervalMsDefault;
  if (
    !isNumber(pollIntervalMs) ||
    !Number.isInteger(pollIntervalMs) ||
    pollIntervalMs <= 0 ||
    pollIntervalMs > MaxTimerDelayMs
  ) {
    throw new TypeError(
      `pollIntervalMs must be a positive integer no greater than ${MaxTimerDelayMs}, got: ${String(pollIntervalMs)}`,
    );
  }
  return pollIntervalMs;
}

/**
 * Shared lifecycle for self-scheduling, non-overlapping polling subscriptions.
 * Subclasses are unnecessary: callers provide the observation and diff logic.
 */
export class PollingWatcher<TSnapshot, TChange> extends EventEmitter {
  readonly ready: Promise<TSnapshot>;
  lastError: Error | undefined;

  private readonly pollIntervalMs: number;
  private readonly observe: PollSource<TSnapshot>;
  private readonly reconcile: (
    previous: TSnapshot,
    current: TSnapshot,
  ) => TChange | undefined;
  private readonly cloneSnapshot: (snapshot: TSnapshot) => TSnapshot;
  private readonly signal: AbortSignal | undefined;
  private readonly abortListener: () => void;
  private readonly closedPromise: Promise<void>;
  private readonly resolveClosed: () => void;
  private timer: NodeJS.Timeout | undefined;
  private current: TSnapshot | undefined;
  private persistent: boolean;
  private isClosed = false;

  constructor(
    options: PollingWatcherOptions,
    observe: PollSource<TSnapshot>,
    reconcile: (previous: TSnapshot, current: TSnapshot) => TChange | undefined,
    cloneSnapshot: (snapshot: TSnapshot) => TSnapshot = (snapshot) => snapshot,
  ) {
    super();
    this.pollIntervalMs = validatePollIntervalMs(options.pollIntervalMs);
    this.persistent = options.persistent ?? true;
    this.observe = observe;
    this.reconcile = reconcile;
    this.cloneSnapshot = cloneSnapshot;
    this.signal = options.signal;
    this.abortListener = () => this.close();
    let resolveClosed!: () => void;
    this.closedPromise = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    this.resolveClosed = resolveClosed;
    this.signal?.throwIfAborted();
    this.signal?.addEventListener("abort", this.abortListener, { once: true });

    this.ready = this.initialize();
    // The caller can still await the original rejecting promise. This attached
    // handler only prevents an ignored `ready` from becoming an unhandled
    // rejection in callback-only usage.
    void this.ready.catch(() => {});
  }

  get closed(): boolean {
    return this.isClosed;
  }

  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.signal?.removeEventListener("abort", this.abortListener);
    this.resolveClosed();
  }

  ref(): this {
    this.persistent = true;
    this.timer?.ref();
    return this;
  }

  unref(): this {
    this.persistent = false;
    this.timer?.unref();
    return this;
  }

  hasRef(): boolean {
    return this.persistent;
  }

  private async initialize(): Promise<TSnapshot> {
    let observation: PollObservation<TSnapshot>;
    try {
      observation = this.observe();
      // `close()` settles ready immediately, but cannot cancel filesystem
      // work already submitted to libuv/native code. Always observe that raw
      // promise so a later rejection cannot become unhandled.
      const settled = observation.settled.catch(() => {});
      const result = await Promise.race([
        observation.value.then((value) => ({ closed: false as const, value })),
        this.closedPromise.then(() => ({ closed: true as const })),
      ]);
      if (result.closed || this.isClosed) {
        throw this.closedBeforeReadyError();
      }
      const observed = result.value;
      this.current = this.cloneSnapshot(observed);
      // `ready` describes the caller-visible baseline and can resolve before a
      // timed-out raw request finishes. The recurring loop still waits for the
      // raw work so it never overlaps even the initial observation.
      void settled.then(() => this.schedule());
      return this.cloneSnapshot(observed);
    } catch (error) {
      this.lastError = toError(error);
      this.close();
      throw this.lastError;
    }
  }

  private schedule(): void {
    if (this.isClosed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.poll();
    }, this.pollIntervalMs);
    if (!this.persistent) this.timer.unref();
  }

  private async poll(): Promise<void> {
    if (this.isClosed || this.current == null) return;

    let change: TChange | undefined;
    let error: Error | undefined;
    let settled: Promise<unknown> = Promise.resolve();
    try {
      const observation = this.observe();
      settled = observation.settled;
      const observed = await observation.value;
      if (!this.isClosed) {
        const previous = this.current;
        const next = this.cloneSnapshot(observed);
        change = this.reconcile(previous, next);
        this.current = next;
        this.lastError = undefined;
      }
    } catch (cause) {
      error = this.lastError = toError(cause);
    }

    try {
      if (!this.isClosed && change != null) {
        this.emit("change", change);
      } else if (
        !this.isClosed &&
        error != null &&
        this.listenerCount("error") > 0
      ) {
        // A transient polling failure is non-fatal and the prior snapshot is
        // retained. Avoid EventEmitter's process-throwing unhandled `error`
        // behavior when the caller does not need these diagnostics.
        this.emit("error", error);
      }
    } finally {
      // A caller-visible timeout does not cancel the underlying filesystem
      // request. Waiting here prevents one wedged resource from accumulating a
      // new libuv/native request on every interval.
      await settled.catch(() => {});
      this.schedule();
    }
  }

  private closedBeforeReadyError(): Error {
    if (this.signal?.aborted && this.signal.reason instanceof Error) {
      return this.signal.reason;
    }
    const error = new Error("Polling watcher closed before it was ready");
    error.name = "AbortError";
    return error;
  }
}

export function resolvedObservation<T>(value: Promise<T>): PollObservation<T> {
  return { value, settled: value };
}
