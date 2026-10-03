// src/darwin-hidden-fifo.test.ts

import { execFileSync } from "node:child_process";
import { closeSync, constants, openSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHiddenMetadata, isHidden, setHidden } from "./index";
import { describePlatform } from "./test-utils/platform";
import { getTestTimeout } from "./test-utils/test-timeout-config";

// A read-only open() of a FIFO with no writer blocks until a writer appears.
// The macOS hidden-attribute workers run on libuv's pool, so each such call
// would park one of its threads (four by default) indefinitely.
describePlatform("darwin")("hidden attributes on a FIFO (macOS)", () => {
  let tempDir: string;
  let fifo: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fs-meta-fifo-"));
    // No leading dot: isHidden() answers dot-prefixed names without native code.
    fifo = join(tempDir, "fifo");
    execFileSync("mkfifo", [fifo]);
  });

  afterEach(async () => {
    // Opening a write end wakes any reader still blocked in open(), so a
    // regression fails its deadline without leaving a parked libuv thread that
    // keeps Jest from exiting.
    try {
      closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK));
    } catch (error) {
      // ENXIO: no reader has the FIFO open, so nothing is blocked.
      if ((error as NodeJS.ErrnoException).code !== "ENXIO") throw error;
    }
    await rm(tempDir, { recursive: true, force: true, maxRetries: 1 });
  });

  async function settles<T>(op: Promise<T>): Promise<T> {
    const deadlineMs = getTestTimeout(2000);
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`did not settle within ${deadlineMs}ms`)),
        deadlineMs,
      );
    });
    try {
      return await Promise.race([op, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  it("isHidden() settles", async () => {
    await expect(settles(isHidden(fifo))).resolves.toBe(false);
  });

  it("getHiddenMetadata() settles", async () => {
    await expect(settles(getHiddenMetadata(fifo))).resolves.toMatchObject({
      hidden: false,
      dotPrefix: false,
      systemFlag: false,
    });
  });

  it('setHidden(…, "systemFlag") settles', async () => {
    const result = setHidden(fifo, true, "systemFlag");
    await expect(settles(result)).resolves.toEqual({
      pathname: fifo,
      actions: { dotPrefix: false, systemFlag: true },
    });
    await expect(settles(isHidden(fifo))).resolves.toBe(true);
  });
});
