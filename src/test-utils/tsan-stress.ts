/**
 * ThreadSanitizer concurrency stress harness.
 *
 * Run by scripts/tsan-test.sh with the TSan runtime preloaded.
 *
 * WHY THIS EXISTS INSTEAD OF RUNNING THE JEST SUITE UNDER TSAN
 *
 * TSan must be LD_PRELOADed into `node` (Node is not TSan-instrumented). That
 * preload is inherited by every CHILD PROCESS, and the debuglog suite spawns
 * child `node` processes and asserts on their stdout -- TSan's startup re-exec
 * and diagnostics corrupt those assertions, so ~8 tests fail for reasons that
 * have nothing to do with thread safety. Jest also multiplies TSan's 5-15x
 * slowdown across 600+ tests that are mostly single-threaded.
 *
 * So this harness drives the *threaded* native paths directly, in-process:
 *
 *   1. Concurrent AsyncWorker calls  -> libuv threadpool runs Execute() on many
 *      threads at once and exercises Linux's BlkidCache::mutex_.
 *   2. Debug globals mutated WHILE workers run -> exercises
 *      FSMeta::Debug::enableDebugLogging and the debugPrefixMutex. A missing
 *      lock or a non-atomic flag here is precisely what TSan is for.
 *   3. worker_threads -> several napi_envs in ONE process, each loading the
 *      addon. This is the only way to exercise the per-env instance data and
 *      cleanup hooks in src/common/shutdown.h and the process-global mutex
 *      shared across those envs. Separate teardown workers below are
 *      terminated with native requests still in flight.
 *
 * Workers are given the resolved .node path and use a plain `require` so no
 * TypeScript loader has to be initialized inside them.
 */

import NodeGypBuild from "node-gyp-build";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { _dirname } from "../dirname";

const projectRoot = join(_dirname(), "..");
const bindingPath: string = (
  NodeGypBuild as typeof NodeGypBuild & { path(dir: string): string }
).path(projectRoot);

interface MetadataTarget {
  mountPoint: string;
  device: string;
  fstype: string;
}

interface Binding {
  getVolumeMetadata(opts: MetadataTarget): Promise<unknown>;
  setDebugLogging(enabled: boolean): void;
  setDebugPrefix(prefix: string): void;
}

// bindingPath is resolved by node-gyp-build from this package's own prebuilds/
// build output -- not from user input.
// eslint-disable-next-line @typescript-eslint/no-require-imports, security/detect-non-literal-require
const binding: Binding = require(bindingPath);

/** Concurrency high enough to saturate the libuv threadpool. */
const CONCURRENCY = Math.max(8, Math.min(cpus().length * 2, 16));
const ROUNDS = 6;
const WORKER_COUNT = 4;

function unescapeMountField(value: string): string {
  return value.replace(/\\(040|011|012|134)/g, (encoded) =>
    String.fromCharCode(Number.parseInt(encoded.slice(1), 8)),
  );
}

function metadataTargets(): MetadataTarget[] {
  const root = readFileSync("/proc/self/mounts", "utf8")
    .split("\n")
    .map((line) => {
      const [device, mountPoint, fstype] = line.trim().split(/\s+/);
      return { device, mountPoint, fstype };
    })
    .find(
      (entry) =>
        entry.mountPoint != null &&
        unescapeMountField(entry.mountPoint) === "/",
    );

  assert.ok(root, "expected /proc/self/mounts to contain the root mount");
  assert.ok(root.device, "expected the root mount to have a device/source");
  assert.ok(root.fstype, "expected the root mount to have a filesystem type");
  const target = {
    mountPoint: "/",
    device: unescapeMountField(root.device),
    fstype: unescapeMountField(root.fstype),
  };
  return [target];
}

/**
 * Hammer getVolumeMetadata from many concurrent AsyncWorkers while the debug
 * globals are flipped from the main thread. Metadata failures are ignored on
 * purpose: an unreadable mount point is not what we are testing -- a data race
 * is, and TSan reports that independently of the promise outcome.
 */
async function stressMetadata(targets: MetadataTarget[]): Promise<void> {
  for (let round = 0; round < ROUNDS; round++) {
    const inflight: Promise<unknown>[] = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const target = targets[i % targets.length];
      assert.ok(target);
      inflight.push(binding.getVolumeMetadata(target).catch(() => {}));
    }
    // Mutate the debug globals WHILE the workers above are running on the
    // threadpool. This is the race window we most want TSan to inspect.
    binding.setDebugLogging(round % 2 === 0);
    binding.setDebugPrefix(`tsan-stress-${round}`);
    await Promise.all(inflight);
  }
  binding.setDebugLogging(false);
}

/**
 * Each Worker is a separate napi_env in the SAME process: it registers its own
 * instance data / cleanup hook (shutdown.h) while sharing the process-global
 * mutex with every other env. These workers complete normally; the dedicated
 * teardown workers below cover termination with in-flight AsyncWorkers.
 */
function runWorker(id: number, targets: MetadataTarget[]): Promise<void> {
  const source = `
    const { workerData, parentPort } = require("node:worker_threads");
    const binding = require(workerData.bindingPath);
    (async () => {
      for (let round = 0; round < ${ROUNDS}; round++) {
        const inflight = [];
        for (let i = 0; i < ${CONCURRENCY}; i++) {
          const target = workerData.targets[i % workerData.targets.length];
          inflight.push(binding.getVolumeMetadata(target).catch(() => {}));
        }
        binding.setDebugLogging(round % 2 === 1);
        binding.setDebugPrefix("tsan-worker-${id}-" + round);
        await Promise.all(inflight);
      }
      binding.setDebugLogging(false);
      parentPort.postMessage("done");
    })().catch((err) => { throw err; });
  `;

  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(source, {
      eval: true,
      workerData: { bindingPath, targets },
    });
    let done = false;
    worker.on("message", (m) => {
      if (m === "done") done = true;
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`worker ${id} exited with ${code}`));
      else if (!done) reject(new Error(`worker ${id} exited before finishing`));
      else resolve();
    });
  });
}

/** Terminate an env immediately after it queues native work. */
function runTeardownWorker(
  id: number,
  targets: MetadataTarget[],
): Promise<void> {
  const source = `
    const { workerData, parentPort } = require("node:worker_threads");
    const binding = require(workerData.bindingPath);
    for (let i = 0; i < ${CONCURRENCY * 2}; i++) {
      const target = workerData.targets[i % workerData.targets.length];
      binding.getVolumeMetadata(target).catch(() => {});
    }
    parentPort.postMessage("inflight");
  `;

  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(source, {
      eval: true,
      workerData: { bindingPath, targets },
    });
    worker.once("error", reject);
    worker.once("message", (message) => {
      if (message !== "inflight") {
        reject(new Error(`teardown worker ${id} sent an unexpected message`));
        return;
      }
      void worker.terminate().then(() => resolve(), reject);
    });
  });
}

async function main(): Promise<void> {
  console.log(`TSan stress: binding=${bindingPath}`);
  const targets = metadataTargets();
  console.log(
    `TSan stress: concurrency=${CONCURRENCY} rounds=${ROUNDS} ` +
      `workers=${WORKER_COUNT} targets=${JSON.stringify(targets)}`,
  );
  console.log("TSan stress: BlkidCache path enabled with non-empty device");

  // 1) Main-thread threadpool saturation + debug-global mutation.
  await stressMetadata(targets);

  // 2) Several envs at once, each doing the same, then tearing down.
  await Promise.all(
    Array.from({ length: WORKER_COUNT }, (_, i) => runWorker(i, targets)),
  );

  // 3) Tear worker envs down while their AsyncWorkers are still in flight.
  await Promise.all(
    Array.from({ length: WORKER_COUNT }, (_, i) =>
      runTeardownWorker(i, targets),
    ),
  );

  // 4) Main thread again after worker envs have been destroyed, to catch races
  //    between teardown and the surviving process globals.
  await stressMetadata(targets);

  assert.ok(targets.length > 0, "expected at least one metadata target");
  console.log("TSAN_STRESS_OK");
}

void main().catch((err: unknown) => {
  console.error("TSan stress harness failed:", err);
  process.exitCode = 1;
});
