// src/options.test.ts

import { availableParallelism } from "node:os";
import { env } from "node:process";
import {
  getMaxConcurrencyDefault,
  getTimeoutMsDefault,
  OptionsDefault,
  optionsWithDefaults,
  uvThreadpoolSize,
} from "./options";
import type { Options } from "./types/options";

describe("options()", () => {
  it("should return default FsOptions when no overrides are provided", () => {
    const result = optionsWithDefaults();
    expect(result).toEqual(OptionsDefault);
    expect(result.includeZfsGuids).toBe(false);
  });

  it("should override timeoutMs when provided", () => {
    const override = { timeoutMs: 10000 };
    const result = optionsWithDefaults(override);
    expect(result.timeoutMs).toBe(override.timeoutMs);
    expect(result.systemFsTypes).toEqual(OptionsDefault.systemFsTypes);
  });

  it("should default fields omitted by pre-existing Options values", () => {
    const options: Options = {
      timeoutMs: OptionsDefault.timeoutMs,
      maxConcurrency: OptionsDefault.maxConcurrency,
      systemPathPatterns: OptionsDefault.systemPathPatterns,
      systemFsTypes: OptionsDefault.systemFsTypes,
      linuxMountTablePaths: OptionsDefault.linuxMountTablePaths,
      networkFsTypes: OptionsDefault.networkFsTypes,
      includeSystemVolumes: OptionsDefault.includeSystemVolumes,
      skipNetworkVolumes: OptionsDefault.skipNetworkVolumes,
    };

    expect(optionsWithDefaults(options).includeZfsGuids).toBe(false);
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
      includeZfsGuids: true,
      onlyDirectories: false,
    };
    const result = optionsWithDefaults(overrides);
    expect(result.timeoutMs).toBe(overrides.timeoutMs);
    expect(result.linuxMountTablePaths).toBe(overrides.linuxMountTablePaths);
    expect(result.includeZfsGuids).toBe(true);
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
  const originalValue = env["FS_METADATA_TIMEOUT_MS"];

  afterEach(() => {
    // Restore original env var
    if (originalValue === undefined) {
      delete env["FS_METADATA_TIMEOUT_MS"];
    } else {
      env["FS_METADATA_TIMEOUT_MS"] = originalValue;
    }
  });

  it("should use env var value when set to valid positive integer", () => {
    env["FS_METADATA_TIMEOUT_MS"] = "12345";
    expect(getTimeoutMsDefault()).toBe(12345);
  });

  it("should use default when env var is not set", () => {
    delete env["FS_METADATA_TIMEOUT_MS"];
    expect(getTimeoutMsDefault()).toBe(5000);
  });

  it("should use default when env var is invalid", () => {
    env["FS_METADATA_TIMEOUT_MS"] = "not-a-number";
    expect(getTimeoutMsDefault()).toBe(5000);
  });

  it("should use default when env var is zero or negative", () => {
    env["FS_METADATA_TIMEOUT_MS"] = "0";
    expect(getTimeoutMsDefault()).toBe(5000);

    env["FS_METADATA_TIMEOUT_MS"] = "-100";
    expect(getTimeoutMsDefault()).toBe(5000);
  });
});

describe("UV_THREADPOOL_SIZE environment variable", () => {
  const originalValue = env["UV_THREADPOOL_SIZE"];

  afterEach(() => {
    // Restore original env var
    if (originalValue === undefined) {
      delete env["UV_THREADPOOL_SIZE"];
    } else {
      env["UV_THREADPOOL_SIZE"] = originalValue;
    }
  });

  function withPoolSize(value: string | undefined): number {
    if (value == null) delete env["UV_THREADPOOL_SIZE"];
    else env["UV_THREADPOOL_SIZE"] = value;
    return getMaxConcurrencyDefault();
  }

  // The parser is asserted directly, BEFORE the availableParallelism() cap.
  // Through getMaxConcurrencyDefault() alone every expectation collapses to the
  // core count on a 4-core runner, so these would pass against an
  // implementation that ignored UV_THREADPOOL_SIZE entirely.
  describe("uvThreadpoolSize() parsing", () => {
    function pool(value: string | undefined): number {
      if (value == null) delete env["UV_THREADPOOL_SIZE"];
      else env["UV_THREADPOOL_SIZE"] = value;
      return uvThreadpoolSize();
    }

    it("should use libuv's default of 4 when not set", () => {
      expect(pool(undefined)).toBe(4);
    });

    it("should use a positive value verbatim", () => {
      expect(pool("2")).toBe(2);
      expect(pool("8")).toBe(8);
      expect(pool("1")).toBe(1);
    });

    // atoi("") and atoi("banana") are 0, which libuv clamps up to 1 thread --
    // NOT to the 4-thread default. Verified against Node 24 by timing
    // concurrent pbkdf2 calls.
    it("should collapse zero and non-numeric values to a single thread", () => {
      for (const zeroish of ["", "0", "not-a-number"]) {
        expect(pool(zeroish)).toBe(1);
      }
    });

    // libuv assigns atoi()'s result to an unsigned field, so a negative wraps
    // around and clamps to the 1024 ceiling -- the opposite of a small pool.
    it("should treat negatives and oversized values as the 1024 ceiling", () => {
      expect(pool("-3")).toBe(1024);
      expect(pool("4096")).toBe(1024);
    });

    it("should stop at the first non-digit, like atoi()", () => {
      expect(pool("8abc")).toBe(8);
    });

    // libuv reads the variable into a fixed 16-byte buffer, so a value needing
    // 16+ bytes makes the read fail and the value is ignored outright rather
    // than parsed. Measured on Node 24: 15 bytes selects 1 worker, 16 bytes
    // leaves 4.
    it("should ignore values too long for libuv's 16-byte buffer", () => {
      expect("000000000000001".length).toBe(15);
      expect(pool("000000000000001")).toBe(1);
      expect(pool("0000000000000002")).toBe(4);
      expect(pool("9".repeat(64))).toBe(4);
    });
  });

  describe("getMaxConcurrencyDefault() capping", () => {
    it("should add fixed headroom to the pool, bounded by core count", () => {
      const cores = availableParallelism();
      for (const p of [1, 2, 4, 8]) {
        expect(withPoolSize(String(p))).toBe(Math.min(cores, p + 3));
      }
    });

    it("should never exceed the core count", () => {
      // The pool clamps to 1024 before the headroom is added, so on a host
      // with more than 1027 CPUs the ceiling — not the core count — wins.
      expect(withPoolSize("4096")).toBe(Math.min(availableParallelism(), 1027));
    });

    it("should always allow at least one operation", () => {
      expect(withPoolSize("1")).toBeGreaterThan(0);
    });
  });
});
