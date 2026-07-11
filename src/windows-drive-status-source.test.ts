import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { _dirname } from "./dirname";

describe("Windows drive-status implementation", () => {
  let source: string;

  beforeAll(async () => {
    source = await readFile(
      join(_dirname(), "windows", "drive_status.h"),
      "utf8",
    );
  });

  it("marks blocking callbacks as long-running instead of using a fixed pool", () => {
    expect(source).toContain("TrySubmitThreadpoolCallback");
    expect(source).not.toContain('include "thread_pool.h"');
    expect(source).not.toContain("GetGlobalThreadPool");
    // Replacement capacity must be requested BEFORE the blocking probe runs;
    // CallbackMayRunLong after CheckDriveInternal would be pointless.
    const mayRunLong = source.indexOf("CallbackMayRunLong(instance)");
    const probe = source.indexOf("CheckDriveInternal(task->path)");
    expect(mayRunLong).toBeGreaterThan(-1);
    expect(probe).toBeGreaterThan(-1);
    expect(mayRunLong).toBeLessThan(probe);
  });

  it("pins the addon DLL for the callback's lifetime", () => {
    // Guards against a use-after-unload crash when a Node Worker that is the
    // addon's last loader tears down while a probe is still blocked in the pool.
    expect(source).toContain("GetModuleHandleEx");
    expect(source).toContain("FreeLibraryWhenCallbackReturns");
  });

  it("treats only an empty wildcard search as accessible, not other errors", () => {
    // ERROR_FILE_NOT_FOUND -> Healthy must be guarded by the exact conditional,
    // with every other error still classified by MapErrorToDriveStatus.
    expect(source).toMatch(
      /if\s*\(\s*error\s*==\s*ERROR_FILE_NOT_FOUND\s*\)\s*\{\s*return\s+DriveStatus::Healthy;/,
    );
    expect(source).toContain("return MapErrorToDriveStatus(error);");
  });
});
