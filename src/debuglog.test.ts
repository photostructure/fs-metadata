import { jest } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { env } from "node:process";
import { debug } from "./debuglog";
import { _dirname } from "./dirname";
import {
  getTestTimeout,
  isAlpineLinux,
  isEmulated,
} from "./test-utils/test-timeout-config.cjs";

// Skip these process-spawning tests on Alpine ARM64 due to extreme emulation slowness
const isEmulatedAlpine = isEmulated() && isAlpineLinux();

// Use describe.skip for the entire suite on Alpine ARM64
const describeOrSkip = isEmulatedAlpine ? describe.skip : describe;

describeOrSkip("debuglog integration tests (process spawning)", () => {
  beforeAll(() => {
    // Tests are already skipped via describe.skip when isEmulatedAlpine is true
  });

  afterAll(() => {
    // spawnSync should handle process cleanup automatically
  });

  beforeEach(() => {
    // Clear any module cache to ensure clean state
    jest.clearAllMocks();
  });

  function runChildTest(nodeDebug?: string) {
    const childEnv: Record<string, string | undefined> = {
      ...env,
    };
    if (nodeDebug != null) {
      childEnv["NODE_DEBUG"] = nodeDebug;
    }

    const script = join(_dirname(), "test-utils", "debuglog-child.ts");
    const timeout = getTestTimeout(3000); // Base 3s timeout, adjusted for environment

    // Use npx with --yes flag to avoid prompts
    const command = "npx";
    const args = ["--yes", "tsx", script];

    // Use spawnSync for better process control
    const result = spawnSync(command, args, {
      env: childEnv,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true, // Hide console window on Windows
      shell: process.platform === "win32", // Windows requires shell for npx to work
      timeout,
    });

    // Check for errors
    if (result.error) {
      throw new Error(
        `Failed to spawn child process: ${result.error.message} (${(result.error as NodeJS.ErrnoException).code ?? "unknown code"})`,
      );
    }

    if (result.status !== 0) {
      throw new Error(
        `Child process exited with status ${result.status}${result.stderr ? `\nstderr: ${result.stderr}` : ""}`,
      );
    }

    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error(
        `Failed to parse child output: ${result.stdout}${result.stderr ? `\nstderr: ${result.stderr}` : ""}`,
      );
    }
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

describe("debug function", () => {
  test("should not write when debug is disabled", () => {
    // Mock stderr.write to verify it's not called
    const mockWrite = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    // Ensure debug is disabled (default state)
    debug("test message", "arg1", "arg2");
    expect(mockWrite).not.toHaveBeenCalled();

    mockWrite.mockRestore();
  });

  test("debug function handles various argument types", () => {
    const mockWrite = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    // Even when disabled, this tests that the function doesn't crash
    debug("test %s %d %o", "string", 123, { key: "value" });
    debug("no args");
    debug("with error", new Error("test error"));
    expect(mockWrite).not.toHaveBeenCalled();

    mockWrite.mockRestore();
  });

  test("debug writes output when enabled", () => {
    const childEnv: Record<string, string | undefined> = {
      ...env,
      NODE_DEBUG: "fs-metadata",
    };

    const script = join(_dirname(), "test-utils", "debuglog-enabled-child.ts");
    const timeout = getTestTimeout(6000); // Base 6s timeout, adjusted for environment

    // Use npx with --yes flag to avoid prompts
    const command = "npx";
    const args = ["--yes", "tsx", script];

    // Use spawnSync for better process control
    const result = spawnSync(command, args, {
      env: childEnv,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true, // Hide console window on Windows
      shell: process.platform === "win32", // Windows requires shell for npx to work
      timeout,
    });

    // Check for errors
    if (result.error) {
      throw new Error(
        `Failed to spawn child process: ${result.error.message} (${(result.error as NodeJS.ErrnoException).code ?? "unknown code"})`,
      );
    }

    if (result.status !== 0) {
      throw new Error(
        `Child process exited with status ${result.status}${result.stderr ? `\nstderr: ${result.stderr}` : ""}`,
      );
    }

    // The stdout should contain "DONE"
    expect(result.stdout.trim()).toBe("DONE");
  });
});
