import { statfs } from "node:fs/promises";
import { validateTimeoutMs, withTimeout } from "./async";
import { getTimeoutMsDefault } from "./options";
import {
  type PollingSubscription,
  type PollingWatcherOptions,
  PollingWatcher,
} from "./polling_watcher";
import { isNotBlank } from "./string";

export type AvailableSpaceState = "aboveMinimum" | "belowMinimum";

export interface AvailableSpaceStatus {
  path: string;
  availableBytes: number;
  state: AvailableSpaceState;
}

export interface AvailableSpaceChange {
  previous: AvailableSpaceStatus;
  current: AvailableSpaceStatus;
}

export interface WatchAvailableSpaceOptions extends PollingWatcherOptions {
  /** Threshold whose crossings should be reported. */
  minimumAvailableBytes: number;
  /** Extra available bytes required before recovering from below-minimum. */
  hysteresisBytes?: number;
  /**
   * Caller-visible budget for each capacity probe; 0 disables it. Defaults to
   * {@link getTimeoutMsDefault}.
   */
  timeoutMs?: number;
}

export type AvailableSpaceChangeListener = (
  change: AvailableSpaceChange,
) => void;

export type AvailableSpaceWatcher = PollingSubscription<
  AvailableSpaceStatus,
  AvailableSpaceChange
>;

type AvailableBytesProbe = () => Promise<number>;
type StatFsResult = { bavail: bigint; bsize: bigint };
type StatFsFn = (path: string) => Promise<StatFsResult>;

const statfsBigInt: StatFsFn = (path) => statfs(path, { bigint: true });

function validateBytes(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

export async function getAvailableBytes(
  path: string,
  statfsImpl: StatFsFn = statfsBigInt,
): Promise<number> {
  const stats = await statfsImpl(path);
  if (stats.bavail < 0n || stats.bsize <= 0n) {
    throw new Error(`statfs returned invalid block counts for ${path}`);
  }
  const availableBytes = Number(stats.bavail * stats.bsize);
  if (!Number.isFinite(availableBytes) || availableBytes < 0) {
    throw new Error(`statfs returned invalid available bytes for ${path}`);
  }
  return availableBytes;
}

export function createAvailableSpaceWatcher(
  path: string,
  options: WatchAvailableSpaceOptions,
  probe: AvailableBytesProbe,
  listener?: AvailableSpaceChangeListener,
): AvailableSpaceWatcher {
  if (!isNotBlank(path) || path.includes("\0")) {
    throw new TypeError("path must be a non-blank string without null bytes");
  }
  const minimumAvailableBytes = validateBytes(
    options.minimumAvailableBytes,
    "minimumAvailableBytes",
  );
  const hysteresisBytes = validateBytes(
    options.hysteresisBytes ?? 0,
    "hysteresisBytes",
  );
  if (minimumAvailableBytes + hysteresisBytes > Number.MAX_SAFE_INTEGER) {
    throw new TypeError(
      "minimumAvailableBytes + hysteresisBytes must be a safe integer",
    );
  }
  const timeoutMs = validateTimeoutMs(
    options.timeoutMs ?? getTimeoutMsDefault(),
    "watchAvailableSpace",
  );

  let lastStatus: AvailableSpaceStatus | undefined;
  const watcher = new PollingWatcher<
    AvailableSpaceStatus,
    AvailableSpaceChange
  >(
    options,
    () => {
      const underlying = probe();
      const value = withTimeout({
        desc: `watchAvailableSpace(${JSON.stringify(path)})`,
        promise: underlying,
        timeoutMs,
      }).then((availableBytes) => {
        if (
          !Number.isFinite(availableBytes) ||
          !Number.isInteger(availableBytes) ||
          availableBytes < 0
        ) {
          throw new Error(`available-byte probe returned an invalid value`);
        }
        const state: AvailableSpaceState =
          lastStatus?.state === "belowMinimum"
            ? availableBytes >= minimumAvailableBytes + hysteresisBytes
              ? "aboveMinimum"
              : "belowMinimum"
            : availableBytes < minimumAvailableBytes
              ? "belowMinimum"
              : "aboveMinimum";
        return (lastStatus = { path, availableBytes, state });
      });
      return {
        value,
        settled: underlying.then(
          () => undefined,
          () => undefined,
        ),
      };
    },
    (previous, current) =>
      previous.state === current.state
        ? undefined
        : { previous: { ...previous }, current: { ...current } },
    (snapshot) => ({ ...snapshot }),
  );
  if (listener != null) watcher.on("change", listener);
  return watcher as AvailableSpaceWatcher;
}

export function watchAvailableSpaceImpl(
  path: string,
  options: WatchAvailableSpaceOptions,
  listener?: AvailableSpaceChangeListener,
): AvailableSpaceWatcher {
  return createAvailableSpaceWatcher(
    path,
    options,
    () => getAvailableBytes(path),
    listener,
  );
}
