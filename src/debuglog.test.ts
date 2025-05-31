import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { env } from "node:process";
import { _dirname } from "./dirname";

describe("debuglog integration tests", () => {
  function runChildTest(nodeDebug?: string) {
    const childEnv: Record<string, string | undefined> = {
      ...env,
    };
    if (nodeDebug != null) {
      childEnv["NODE_DEBUG"] = nodeDebug;
    }

    const script = join(_dirname(), "test-utils", "debuglog-child.ts");

    const result = execFileSync(process.execPath, ["--import=tsx", script], {
      env: childEnv,
      encoding: "utf8",
    });

    return JSON.parse(result);
  }

  test("uses fs-metadata when NODE_DEBUG=fs-metadata", () => {
    const result = runChildTest("fs-metadata");
    expect(result).toEqual({
      isDebugEnabled: true,
      debugLogContext: "fs-metadata",
    });
  });

  test("uses fs-meta when NODE_DEBUG=fs-meta", () => {
    const result = runChildTest("fs-meta");
    expect(result).toEqual({
      isDebugEnabled: true,
      debugLogContext: "fs-meta",
    });
  });

  test("uses fs-meta when NODE_DEBUG=fs-*", () => {
    const result = runChildTest("fs-*");
    expect(result).toEqual({
      isDebugEnabled: true,
      debugLogContext: "fs-metadata",
    });
  });

  test("falls back to photostructure:fs-metadata when no debug enabled", () => {
    const result = runChildTest("");
    expect(result).toEqual({
      isDebugEnabled: false,
      debugLogContext: "photostructure:fs-metadata",
    });
  });

  test("falls back to photostructure:fs-metadata when no debug enabled", () => {
    const result = runChildTest("photostructure*");
    expect(result).toEqual({
      isDebugEnabled: true,
      debugLogContext: "photostructure:fs-metadata",
    });
  });

  test("handles uppercase debug names", () => {
    const result = runChildTest("FS-METADATA");
    expect(result).toEqual({
      isDebugEnabled: true,
      debugLogContext: "fs-metadata",
    });
  });

  test("handles FS-META uppercase", () => {
    const result = runChildTest("FS-META");
    expect(result).toEqual({
      isDebugEnabled: true,
      debugLogContext: "fs-meta",
    });
  });
});
