// src/options.test.ts

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { _dirname } from "./dirname";
import { OptionsDefault, optionsWithDefaults } from "./options";

describe("options()", () => {
  it("should return default FsOptions when no overrides are provided", () => {
    const result = optionsWithDefaults();
    expect(result).toEqual(OptionsDefault);
  });

  it("should override timeoutMs when provided", () => {
    const override = { timeoutMs: 10000 };
    const result = optionsWithDefaults(override);
    expect(result.timeoutMs).toBe(override.timeoutMs);
    expect(result.systemFsTypes).toEqual(OptionsDefault.systemFsTypes);
  });

  it("should override excludedFileSystemTypes when provided", () => {
    const override = { systemFsTypes: ["custom-fs"] };
    const result = optionsWithDefaults(override);
    expect(result.systemFsTypes).toEqual(override.systemFsTypes);
    expect(result.timeoutMs).toBe(OptionsDefault.timeoutMs);
  });

  it("should override multiple fields when provided", () => {
    const overrides = {
      timeoutMs: 8000,
      linuxMountTablePaths: ["/etc/mtab"],
      onlyDirectories: false,
    };
    const result = optionsWithDefaults(overrides);
    expect(result.timeoutMs).toBe(overrides.timeoutMs);
    expect(result.linuxMountTablePaths).toBe(overrides.linuxMountTablePaths);
  });

  it("should throw a TypeError if overrides is not an object", () => {
    // @ts-expect-error Testing runtime validation
    expect(() => optionsWithDefaults(null)).toThrow(TypeError);
    // @ts-expect-error Testing runtime validation
    expect(() => optionsWithDefaults("invalid")).toThrow(TypeError);
  });

  it("should preserve default values for fields not overridden", () => {
    const override = { systemPathPatterns: ["/custom/mount"] };
    const result = optionsWithDefaults(override);
    expect(result.systemPathPatterns).toEqual(override.systemPathPatterns);
    expect(result.systemFsTypes).toBe(OptionsDefault.systemFsTypes);
  });
});

describe("FS_METADATA_TIMEOUT_MS environment variable", () => {
  // These tests spawn subprocesses since the env var is parsed at module load time
  // Using node + tsx CLI path directly avoids platform-specific npx resolution issues
  // Use createRequire with pathToFileURL for cross-platform CJS/ESM compatibility
  const script = `import { TimeoutMsDefault } from "./src/options"; console.log(TimeoutMsDefault)`;
  const nodeExe = process.execPath;
  const thisFile = path.join(_dirname(), "options.test.ts");
  const req = createRequire(pathToFileURL(thisFile).href);
  const tsxCliPath = req.resolve("tsx/cli");
  const args = [tsxCliPath, "-e", script];

  it("should use env var value when set to valid positive integer", () => {
    const result = execFileSync(nodeExe, args, {
      env: { ...process.env, FS_METADATA_TIMEOUT_MS: "12345" },
    });
    expect(result.toString().trim()).toBe("12345");
  });

  it("should use default when env var is not set", () => {
    const envWithoutVar = { ...process.env };
    delete envWithoutVar["FS_METADATA_TIMEOUT_MS"];
    const result = execFileSync(nodeExe, args, { env: envWithoutVar });
    expect(result.toString().trim()).toBe("5000");
  });

  it("should use default when env var is invalid", () => {
    const result = execFileSync(nodeExe, args, {
      env: { ...process.env, FS_METADATA_TIMEOUT_MS: "not-a-number" },
    });
    expect(result.toString().trim()).toBe("5000");
  });

  it("should use default when env var is zero or negative", () => {
    let result = execFileSync(nodeExe, args, {
      env: { ...process.env, FS_METADATA_TIMEOUT_MS: "0" },
    });
    expect(result.toString().trim()).toBe("5000");

    result = execFileSync(nodeExe, args, {
      env: { ...process.env, FS_METADATA_TIMEOUT_MS: "-100" },
    });
    expect(result.toString().trim()).toBe("5000");
  });
});
