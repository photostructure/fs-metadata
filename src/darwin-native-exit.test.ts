import NodeGypBuild from "node-gyp-build";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex, Readable } from "node:stream";
import { _dirname } from "./dirname";
import { isMacOS } from "./platform";

const root = join(_dirname(), "..");
const requireTool = createRequire(join(root, "package.json"));

(isMacOS ? describe : describe.skip)("macOS native exit isolation", () => {
  let scratch: string;
  let interposer: string;
  let addonPath: string;
  let injectedLibraries: string[];
  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), "fs-metadata-exit-"));
    interposer = join(scratch, "block.dylib");
    // Ground truth: CI downloads only prebuilds/ before running npm run tests.
    // Reproduce from a clean checkout: npm run build:native
    // Then: npm test -- --runInBand src/darwin-native-exit.test.ts
    // Resolve without loading: the teardown child's Worker must be the
    // addon's last owner, and build/Release need not exist in a packaged build.
    addonPath = NodeGypBuild.path(root);
    // ASan can remove DYLD_INSERT_LIBRARIES from the environment after loading.
    // Recover its actual loaded path so subprocesses get the same runtime.
    const report = process.report.getReport() as { sharedObjects: string[] };
    injectedLibraries = Array.from(
      new Set([
        ...(process.env["DYLD_INSERT_LIBRARIES"]?.split(":") ?? []),
        ...report.sharedObjects.filter((path) =>
          /libclang_rt\.(?:asan|ubsan).*\.dylib$/.test(path),
        ),
        interposer,
      ]),
    );
    const built = spawnSync(
      "clang++",
      [
        "-std=c++20",
        "-dynamiclib",
        "-framework",
        "DiskArbitration",
        "-framework",
        "CoreFoundation",
        join(_dirname(), "test-utils", "darwin-blocking-interposer.cpp"),
        "-o",
        interposer,
      ],
      { encoding: "utf8" },
    );
    expect({ status: built.status, stderr: built.stderr }).toEqual({
      status: 0,
      stderr: "",
    });
  });
  afterAll(async () => {
    if (scratch)
      await rm(scratch, { recursive: true, force: true, maxRetries: 1 });
  });

  async function run(scenario: string, operation = "da", kind = "metadata") {
    const child = spawn(
      process.execPath,
      [
        "--import",
        requireTool.resolve("tsx"),
        join(_dirname(), "test-utils", "darwin-exit-child.ts"),
        scenario,
        addonPath,
        kind,
      ],
      {
        env: {
          ...process.env,
          UV_THREADPOOL_SIZE: "1",
          DYLD_INSERT_LIBRARIES: injectedLibraries.join(":"),
          FSMETA_TEST_BLOCK: operation,
        },
        stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "ipc"],
      },
    );
    let output = "";
    let stderr = "";
    let ready = false;
    let timedOut = false;
    const exit = new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    // A failure watchdog, never a readiness delay. SIGKILL also reaps the old
    // implementation whose process.exit() blocks while joining libuv.
    const watchdog = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 10000);
    child.stdout!.on("data", (data) => {
      output += String(data);
      if (
        scenario === "terminate" &&
        output.includes("TERMINATED") &&
        !output.includes("RELEASE_SENT")
      ) {
        output += "RELEASE_SENT\n";
        (child.stdio[4] as Duplex).write("release");
        child.send("recover");
      }
    });
    child.stderr!.on("data", (data) => {
      stderr += String(data);
    });
    (child.stdio[3] as Readable).on("data", (data) => {
      if (!ready && String(data).includes("B")) {
        ready = true;
        child.send("run");
      }
    });
    try {
      const result = await exit;
      expect({ ready, timedOut, ...result, stderr }).toEqual({
        ready: true,
        timedOut: false,
        code: 0,
        signal: null,
        stderr: "",
      });
      return output;
    } finally {
      clearTimeout(watchdog);
      if (child.exitCode == null && child.signalCode == null)
        child.kill("SIGKILL");
    }
  }

  it.each(["metadata", "mounts"])(
    "process.exit with unlimited %s survives a blocked DA call",
    async (kind) => {
      await run("exit", "da", kind);
    },
    15000,
  );
  it("process.exit survives a blocked IOKit call", async () => {
    await run("exit", "iokit");
  }, 15000);
  it("process.exit with a finite deadline survives a blocked DA call", async () => {
    await run("exit-finite");
  }, 15000);
  it.each(["public-metadata", "public-metadata-path", "public-mount-path"])(
    "%s resolves paths without occupying libuv",
    async (kind) => {
      await run("exit", "path", kind);
    },
    15000,
  );
  it("enumeration survives an unlimited blocked directory probe", async () => {
    await run("exit", "directory", "public-mounts");
  }, 15000);
  it("reports one stalled directory and reuses its probe across enumerations", async () => {
    expect(await run("probe", "directory")).toContain("PROBE_TIMEOUT");
  }, 15000);
  it("a native deadline permits natural exit despite a blocked call", async () => {
    expect(await run("natural")).toContain("TIMEOUT");
  }, 15000);
  it("keeps libuv available and bounds admission behind a blocked DA call", async () => {
    expect(await run("pool")).toContain("POOL_AVAILABLE");
  }, 15000);
  it("tears down a Worker and tolerates native completion afterward", async () => {
    expect(await run("terminate")).toContain("RECOVERED");
  }, 15000);
});
