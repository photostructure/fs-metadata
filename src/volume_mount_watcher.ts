import { mapConcurrent, validateTimeoutMs, withTimeout } from "./async";
import { getTimeoutMsDefault, optionsWithDefaults } from "./options";
import { isLinux, isWindows } from "./platform";
import {
  type PollingSubscription,
  type PollingWatcherOptions,
  type PollObservation,
  PollingWatcher,
  resolvedObservation,
} from "./polling_watcher";
import { isRemoteFsType } from "./remote_info";
import { assignSystemVolume } from "./system_volume";
import type { MountPoint } from "./types/mount_point";
import type { NativeBindingsFn } from "./types/native_bindings";
import {
  directoryStatusObservation,
  healthProbeTimeoutMs,
} from "./volume_health_status";
import type { GetVolumeMountPointOptions } from "./volume_mount_points";
import { getVolumeMountPointsImpl } from "./volume_mount_points";

export type WatchVolumeMountPointsOptions = GetVolumeMountPointOptions &
  PollingWatcherOptions;

export function validateVolumeMountWatcherOptions(
  options: WatchVolumeMountPointsOptions,
  windows = isWindows,
): void {
  if (windows && options.systemFsTypes != null) {
    throw new TypeError(
      "watchVolumeMountPoints does not support systemFsTypes on Windows because shallow drive enumeration does not query filesystem types",
    );
  }
}

export interface VolumeMountChange {
  /** Monotonically increasing generation of emitted changes. */
  generation: number;
  /** Mount points present in the current snapshot but not the prior one. */
  added: readonly MountPoint[];
  /** Last-observed records absent from the current snapshot. */
  removed: readonly MountPoint[];
}

export type VolumeMountChangeListener = (change: VolumeMountChange) => void;

export type VolumeMountWatcher = PollingSubscription<
  readonly MountPoint[],
  VolumeMountChange
>;

type MountPointSnapshot = () =>
  Promise<MountPoint[]> | PollObservation<MountPoint[]>;

function mountPointObservation(
  snapshot: ReturnType<MountPointSnapshot>,
): PollObservation<MountPoint[]> {
  return "value" in snapshot ? snapshot : resolvedObservation(snapshot);
}

export function volumeMountPathKey(
  mountPoint: string,
  caseInsensitive = isWindows,
): string {
  return caseInsensitive ? mountPoint.toLowerCase() : mountPoint;
}

export function createVolumeMountWatcher(
  options: PollingWatcherOptions &
    Pick<GetVolumeMountPointOptions, "timeoutMs">,
  scan: MountPointSnapshot,
  listener?: VolumeMountChangeListener,
): VolumeMountWatcher {
  let generation = 0;
  const timeoutMs = validateTimeoutMs(
    options.timeoutMs ?? getTimeoutMsDefault(),
    "watchVolumeMountPoints",
  );
  const watcher = new PollingWatcher<readonly MountPoint[], VolumeMountChange>(
    options,
    () => {
      const observation = mountPointObservation(scan());
      return {
        value: withTimeout({
          desc: "watchVolumeMountPoints",
          promise: observation.value,
          timeoutMs,
        }),
        // A caller-visible timeout cannot cancel native or filesystem work.
        // Preserve the raw settled promise so PollingWatcher never overlaps it.
        settled: observation.settled,
      };
    },
    (previous, current) => {
      const previousPaths = new Set(
        previous.map((ea) => volumeMountPathKey(ea.mountPoint)),
      );
      const currentPaths = new Set(
        current.map((ea) => volumeMountPathKey(ea.mountPoint)),
      );
      const added = current
        .filter((ea) => !previousPaths.has(volumeMountPathKey(ea.mountPoint)))
        .map((ea) => ({ ...ea }));
      const removed = previous
        .filter((ea) => !currentPaths.has(volumeMountPathKey(ea.mountPoint)))
        .map((ea) => ({ ...ea }));
      return added.length === 0 && removed.length === 0
        ? undefined
        : { generation: ++generation, added, removed };
    },
    (snapshot) => snapshot.map((point) => ({ ...point })),
  );
  if (listener != null) watcher.on("change", listener);
  return watcher as VolumeMountWatcher;
}

export function watchVolumeMountPointsImpl(
  options: WatchVolumeMountPointsOptions,
  nativeFn: NativeBindingsFn,
  listener?: VolumeMountChangeListener,
): VolumeMountWatcher {
  validateVolumeMountWatcherOptions(options);
  const resolved = optionsWithDefaults(options);
  const includeSystemVolumes = resolved.includeSystemVolumes;
  const targetVisibility = new Map<string, boolean>();
  const scan = (): PollObservation<MountPoint[]> => {
    const pendingProbes: Promise<unknown>[] = [];
    const value = (async (): Promise<MountPoint[]> => {
      // Internal shallow enumeration deliberately skips TypeScript
      // system-volume classification for path-resolution callers. Request
      // every entry, clone it, classify without touching the mounted path, and
      // only then apply this watcher's requested filter.
      const points = await getVolumeMountPointsImpl(
        {
          ...resolved,
          // Keep the inner operation raw. createVolumeMountWatcher() applies
          // the caller-visible timeout separately while retaining this scan's
          // settled promise, so a timeout can be reported without overlapping
          // the uncancellable native/filesystem work.
          includeSystemVolumes: true,
          skipHealthProbes: true,
          timeoutMs: 0,
        },
        nativeFn,
      );

      const classified = points.map((point) => {
        const copy = { ...point };
        delete copy.status;
        delete copy.error;
        assignSystemVolume(copy, resolved);
        return copy;
      });
      const systemFiltered = includeSystemVolumes
        ? classified
        : classified.filter((point) => !point.isSystemVolume);

      if (!isLinux) return systemFiltered;
      const currentPaths = new Set(
        systemFiltered.map((point) => point.mountPoint),
      );
      for (const knownPath of targetVisibility.keys()) {
        if (!currentPaths.has(knownPath)) targetVisibility.delete(knownPath);
      }

      // Public Linux enumeration omits local file bind-mount targets. Shallow
      // snapshots cannot know the target type, so probe only newly seen local
      // paths once rather than readdir()ing every mount on every interval.
      // Remote paths are always retained without probing because topology
      // observation has no use for their accessibility status.
      const unknown = systemFiltered.filter(
        (point) => !targetVisibility.has(point.mountPoint),
      );
      await mapConcurrent({
        items: unknown,
        maxConcurrency: resolved.maxConcurrency,
        fn: async (point) => {
          if (isRemoteFsType(point.fstype, resolved.networkFsTypes)) {
            targetVisibility.set(point.mountPoint, true);
            return;
          }
          const observation = directoryStatusObservation(
            point.mountPoint,
            healthProbeTimeoutMs(resolved.timeoutMs),
          );
          pendingProbes.push(observation.settled);
          const status = await observation.value;
          targetVisibility.set(point.mountPoint, status.isDirectory !== false);
        },
      });
      return systemFiltered.filter(
        (point) => targetVisibility.get(point.mountPoint) !== false,
      );
    })();
    const settled = value.then(
      () => Promise.allSettled(pendingProbes),
      () => Promise.allSettled(pendingProbes),
    );
    return { value, settled };
  };
  return createVolumeMountWatcher(options, scan, listener);
}
