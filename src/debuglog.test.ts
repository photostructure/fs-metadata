import { jest } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { env } from "node:process";
import { debug } from "./debuglog";
import { _dirname } from "./dirname";

describe("debuglog integration tests", () => {
  afterAll(() => {
    // Give child processes time to fully exit
    return new Promise((resolve) => setTimeout(resolve, 100));
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

    // Use spawnSync for better process control on Windows
    const result = spawnSync("npx", ["tsx", script], {
      env: childEnv,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true, // Hide console window on Windows
      shell: process.platform === "win32", // Use shell on Windows for npx
      timeout: 5000, // 5 second timeout
    });

    // Check for errors
    if (result.error) {
      // spawnSync errors should not have circular references
      const errorInfo = {
        message: result.error.message,
        code: (result.error as NodeJS.ErrnoException).code,
        platform: process.platform,
        nodeVersion: process.version,
        script,
        nodeDebug,
      };
      
      // Log debugging info to help diagnose Windows issues
      console.error("Windows child process spawn error:", errorInfo);
      
      throw new Error(`Failed to spawn child process: ${result.error.message}`);
    }

    if (result.status !== 0) {
      const errorInfo = {
        status: result.status,
        signal: result.signal,
        stderr: result.stderr?.toString?.() ?? "",
        stdout: result.stdout?.toString?.() ?? "",
        platform: process.platform,
        nodeVersion: process.version,
        script,
        nodeDebug,
      };
      
      // Log debugging info to help diagnose Windows issues
      if (process.platform === "win32") {
        console.error("Windows child process exit error:", errorInfo);
      }
      
      throw new Error(
        `Child process exited with status ${result.status}${result.stderr ? `\nstderr: ${result.stderr}` : ""}`
      );
    }

    try {
      return JSON.parse(result.stdout);
    } catch (parseError) {
      console.error("Failed to parse child output:", {
        stdout: result.stdout,
        stderr: result.stderr,
        parseError: (parseError as Error).message,
      });
      throw new Error(`Failed to parse child output: ${result.stdout}`);
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

    // Use spawnSync for better process control on Windows
    const result = spawnSync("npx", ["tsx", script], {
      env: childEnv,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true, // Hide console window on Windows
      shell: process.platform === "win32", // Use shell on Windows for npx
      timeout: 5000, // 5 second timeout
    });

    // Check for errors
    if (result.error) {
      // spawnSync errors should not have circular references
      const errorInfo = {
        message: result.error.message,
        code: (result.error as NodeJS.ErrnoException).code,
        platform: process.platform,
        nodeVersion: process.version,
        script,
      };
      
      // Log debugging info to help diagnose Windows issues
      console.error("Windows child process spawn error:", errorInfo);
      
      throw new Error(`Failed to spawn child process: ${result.error.message}`);
    }

    if (result.status !== 0) {
      const errorInfo = {
        status: result.status,
        signal: result.signal,
        stderr: result.stderr?.toString?.() ?? "",
        stdout: result.stdout?.toString?.() ?? "",
        platform: process.platform,
        nodeVersion: process.version,
        script,
      };
      
      // Log debugging info to help diagnose Windows issues
      if (process.platform === "win32") {
        console.error("Windows child process exit error:", errorInfo);
      }
      
      throw new Error(
        `Child process exited with status ${result.status}${result.stderr ? `\nstderr: ${result.stderr}` : ""}`
      );
    }

    // The stdout should contain "DONE"
    expect(result.stdout.trim()).toBe("DONE");
  });
});
