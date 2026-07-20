import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { TimeoutError, withTimeout } from "../async";
import { debug } from "../debuglog";

const MaxUint64 = (1n << 64n) - 1n;
const MaxOutputBytes = 4096;

/**
 * Milliseconds of the whole-operation deadline reserved for command-timeout
 * cleanup and final result assembly, so the optional ZFS enrichment never
 * races the public {@link withTimeout} deadline.
 */
export const ZfsEnrichmentReserveMs = 250;

export type ZfsCommandRunner = (
  command: "zfs" | "zpool",
  args: string[],
  timeoutMs: number,
) => Promise<string>;

export interface ZfsGuids {
  zfsDatasetGuid?: string;
  zfsPoolGuid?: string;
}

/**
 * Compute the `execFile` timeout for the opt-in ZFS GUID queries from the
 * whole-operation deadline, reserving {@link ZfsEnrichmentReserveMs} for
 * teardown and assembly.
 *
 * @param deadlineMs absolute deadline (`Date.now()`-based), or `undefined` when
 * the caller disabled the timeout (`timeoutMs === 0`).
 * @param nowMs current `Date.now()` value.
 * @returns `0` (no timeout) when there is no deadline, a positive remaining
 * budget when enrichment should run, or `undefined` when the budget is
 * exhausted and enrichment must be skipped.
 */
export function zfsEnrichmentTimeoutMs(
  deadlineMs: number | undefined,
  nowMs: number,
  reserveMs: number = ZfsEnrichmentReserveMs,
): number | undefined {
  if (deadlineMs == null) return 0;
  const remaining = Math.floor(deadlineMs - nowMs) - reserveMs;
  return remaining > 0 ? remaining : undefined;
}

/** Parse a ZFS GUID without losing precision through a JavaScript number. */
export function parseZfsGuid(value: string): string | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return;
  const guid = BigInt(trimmed);
  return guid > 0n && guid <= MaxUint64 ? guid.toString(10) : undefined;
}

function poolName(dataset: string): string | undefined {
  const trimmed = dataset.trim();
  if (
    trimmed !== dataset ||
    trimmed.length === 0 ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("-") ||
    trimmed.includes("//") ||
    [...trimmed].some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return;
  }
  const separator = trimmed.search(/[/@#]/);
  const pool = separator < 0 ? trimmed : trimmed.slice(0, separator);
  return pool.length === 0 ? undefined : pool;
}

export const runZfsCommand = (
  command: "zfs" | "zpool",
  args: string[],
  timeoutMs: number,
  exec: typeof execFile = execFile,
): Promise<string> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: NodeJS.Timeout | undefined;
    const child = exec(
      command,
      args,
      {
        encoding: "utf8",
        maxBuffer: MaxOutputBytes,
        shell: false,
        windowsHide: true,
      },
      (error, stdout) => {
        if (settled) return;
        settled = true;
        if (timeoutId != null) clearTimeout(timeoutId);
        if (error != null) reject(error);
        else resolve(stdout);
      },
    );

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;

        // This is deliberately SIGTERM, not SIGKILL. These are read-only
        // commands, but a hard kill still cannot interrupt uninterruptible
        // kernel IO. Settle independently, close our pipe handles, and unref
        // the child so optional enrichment cannot fail the metadata call or
        // keep Node alive while the OS finishes handling the process.
        child.kill("SIGTERM");
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();

        reject(
          new TimeoutError(
            `${command} GUID query: timeout after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
    }
  });

async function readGuid(
  command: "zfs" | "zpool",
  args: string[],
  timeoutMs: number,
  run: ZfsCommandRunner,
): Promise<string | undefined> {
  try {
    // Bound injected runners as well as the production child process. The
    // production runner also owns its timer so it can close and unref child
    // resources; this independent boundary guarantees the fail-open result.
    const stdout = await withTimeout({
      desc: `${command} GUID query`,
      promise: run(command, args, timeoutMs),
      timeoutMs,
    });
    const guid = parseZfsGuid(stdout);
    if (guid == null) {
      debug("[zfsGuids] %s returned an invalid GUID: %o", command, stdout);
    }
    return guid;
  } catch (error) {
    // This is optional enrichment. A missing CLI, insufficient permissions, or
    // a command timeout must not make otherwise-valid volume metadata fail.
    debug("[zfsGuids] %s GUID query failed: %o", command, error);
    return;
  }
}

interface PoolGuidRequest {
  promise: Promise<string | undefined>;
  deadlineMs: number | undefined;
}

const poolRequestsByRunner = new WeakMap<
  ZfsCommandRunner,
  Map<string, PoolGuidRequest>
>();

function timeoutCovers(
  existingDeadlineMs: number | undefined,
  callerTimeoutMs: number,
  nowMs: number,
) {
  return (
    existingDeadlineMs == null ||
    (callerTimeoutMs !== 0 && existingDeadlineMs >= nowMs + callerTimeoutMs)
  );
}

async function readPoolGuid(
  pool: string,
  timeoutMs: number,
  run: ZfsCommandRunner,
): Promise<string | undefined> {
  let requests = poolRequestsByRunner.get(run);
  if (requests == null) {
    requests = new Map();
    poolRequestsByRunner.set(run, requests);
  }
  let request = requests.get(pool);
  const nowMs = Date.now();
  if (request == null || !timeoutCovers(request.deadlineMs, timeoutMs, nowMs)) {
    const promise = readGuid(
      "zpool",
      ["get", "-Hp", "-o", "value", "guid", pool],
      timeoutMs,
      run,
    );
    request = {
      promise,
      deadlineMs: timeoutMs === 0 ? undefined : nowMs + timeoutMs,
    };
    requests.set(pool, request);
    void promise.finally(() => {
      if (requests?.get(pool) === request) requests.delete(pool);
    });
  }

  // A shorter-budget caller may share a longer (or unbounded) lookup, but it
  // must retain its own deadline. A longer-budget caller starts a new lookup
  // instead of inheriting a request that may give up too early.
  try {
    return await withTimeout({
      desc: "shared zpool GUID query",
      promise: request.promise,
      timeoutMs,
    });
  } catch (error) {
    debug("[zfsGuids] shared zpool GUID query failed: %o", error);
    return;
  }
}

/**
 * Fetch the opt-in, authoritative ZFS GUID properties for a mounted dataset.
 *
 * Queries are shell-free. Failures degrade field-by-field to `undefined`, and
 * pool lookups are shared only while concurrent requests are in flight so an
 * explicit `zpool reguid` is visible to the next metadata call.
 */
export async function getZfsGuids({
  dataset,
  timeoutMs,
  run = runZfsCommand,
}: {
  dataset: string;
  timeoutMs: number;
  run?: ZfsCommandRunner;
}): Promise<ZfsGuids> {
  const pool = poolName(dataset);
  if (pool == null) return {};
  // The OpenZFS CLI requires the kernel control device. Containers can expose
  // host ZFS mounts without exposing /dev/zfs; avoid spawning commands that
  // cannot succeed in that common configuration.
  if (run === runZfsCommand && !existsSync("/dev/zfs")) {
    debug("[zfsGuids] skipping GUID queries because /dev/zfs is unavailable");
    return {};
  }

  const [zfsDatasetGuid, zfsPoolGuid] = await Promise.all([
    readGuid(
      "zfs",
      ["get", "-Hp", "-o", "value", "guid", dataset],
      timeoutMs,
      run,
    ),
    readPoolGuid(pool, timeoutMs, run),
  ]);

  return {
    ...(zfsDatasetGuid == null ? {} : { zfsDatasetGuid }),
    ...(zfsPoolGuid == null ? {} : { zfsPoolGuid }),
  };
}
