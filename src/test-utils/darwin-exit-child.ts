import { strict as assert } from "node:assert";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";
import { _dirname } from "../dirname";
import {
  getMountPointForPath,
  getVolumeMetadata,
  getVolumeMetadataForPath,
  getVolumeMountPoints,
} from "../index";
import type { NativeBindings } from "../types/native_bindings";

const requireNative = createRequire(join(_dirname(), "darwin-exit-child.ts"));
const addonPath = isMainThread ? process.argv[3] : String(workerData);
assert(addonPath);
// Do not load the addon in the main environment for the teardown test: the
// Worker must be its last owner when termination unloads that environment.
let native: NativeBindings;
if (!isMainThread || process.argv[2] !== "terminate") {
  native = requireNative(addonPath) as NativeBindings;
}

function query(timeoutMs: number, kind = "metadata") {
  if (kind === "public-metadata") return getVolumeMetadata("/", { timeoutMs });
  if (kind === "public-metadata-path")
    return getVolumeMetadataForPath("/", { timeoutMs });
  if (kind === "public-mount-path")
    return getMountPointForPath("/", { timeoutMs });
  if (kind === "public-mounts")
    return getVolumeMountPoints({ timeoutMs, includeSystemVolumes: true });
  return kind === "mounts"
    ? native.getVolumeMountPoints({ timeoutMs })
    : native.getVolumeMetadata({ mountPoint: "/", timeoutMs });
}

if (!isMainThread) {
  void query(0);
  parentPort?.on("message", () => {});
} else {
  const scenario = process.argv[2];
  const worker =
    scenario === "terminate"
      ? new Worker(join(_dirname(), "test-utils", "darwin-exit-child.ts"), {
          workerData: addonPath,
          execArgv: process.execArgv,
        })
      : undefined;
  if (scenario === "probe") {
    void (async () => {
      for (let i = 0; i < 2; i++) {
        const mounts = await getVolumeMountPoints({
          timeoutMs: 2000,
          includeSystemVolumes: true,
        });
        assert.equal(
          mounts.find((mp) => mp.mountPoint === "/")?.status,
          "timeout",
        );
        assert(
          mounts.some((mp) => mp.mountPoint !== "/" && mp.status === "healthy"),
        );
      }
      // The second call must reuse the blocked probe; a new one would succeed.
      process.stdout.write("PROBE_TIMEOUT\n");
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  } else if (!worker) {
    const timeoutMs =
      scenario === "natural" ? 150 : scenario === "exit-finite" ? 1000 : 0;
    void query(timeoutMs, process.argv[4]).catch((error) => {
      assert.match(String(error), /timeout/i);
      process.stdout.write("TIMEOUT\n");
    });
  }

  process.on("message", (action: string) => {
    void (async () => {
      if (action === "recover") {
        native = requireNative(addonPath) as NativeBindings;
        await query(5000);
        process.stdout.write("RECOVERED\n");
        process.disconnect?.();
      } else if (scenario === "exit" || scenario === "exit-finite") {
        process.exit(0);
      } else if (scenario === "natural" || scenario === "probe") {
        process.disconnect?.();
      } else if (scenario === "terminate") {
        assert(worker);
        await worker.terminate();
        process.stdout.write("TERMINATED\n");
      } else if (scenario === "pool") {
        // UV_THREADPOOL_SIZE=1 makes any remaining native AsyncWorker visible.
        await stat(addonPath);
        const results = await Promise.allSettled(
          Array.from({ length: 300 }, (_, i) =>
            query(1000, i % 2 ? "mounts" : "metadata"),
          ),
        );
        assert(results.every((result) => result.status === "rejected"));
        assert(
          results.some(
            (result) =>
              result.status === "rejected" &&
              /busy/i.test(String(result.reason)),
          ),
        );
        process.stdout.write("POOL_AVAILABLE\n");
        process.exit(0);
      }
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  });
}
