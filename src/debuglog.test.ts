import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { env } from "node:process";
import { isESM } from "./platform";

(isESM() ? describe.skip : describe)("debuglog integration tests", () => {
  const childTestPath = join(__dirname, "test-utils", "debuglog-child.ts");

  function runChildTest(nodeDebug?: string) {
    const childEnv: Record<string, string | undefined> = {
      ...env,
    };
    if (nodeDebug != null) {
      childEnv["NODE_DEBUG"] = nodeDebug;
    }

    const result = spawnSync(
      "node",
      ["-r", "ts-node/register", childTestPath],
      {
        env: childEnv,
        encoding: "utf8",
      },
    );

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Child process failed: ${result.stderr}`);
    }

    return JSON.parse(result.stdout);
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
});
