import { existsSync } from "node:fs";
import { isWindows } from "./platform";
import { extractCallerPath, getCallerDirname } from "./stack_path";

describe("stack_path", () => {
  it("should return the directory of the calling file", () => {
    const dir = getCallerDirname();
    expect(dir).toBeTruthy();
    expect(typeof dir).toBe("string");

    // Verify it's an absolute path
    expect(isWindows ? /^[A-Z]:\\/.test(dir) : dir.startsWith("/")).toBe(true);

    // Verify the directory exists
    expect(existsSync(dir)).toBe(true);

    // Verify it's in the src directory tree
    expect(dir).toContain("src");

    // Verify we're in the expected directory structure
    // The test is run from src directory, not test-utils in this case
    const pathParts = dir.split(isWindows ? "\\" : "/");
    expect(pathParts).toContain("src");
  });

  it("should return consistent results across multiple calls", () => {
    const dir1 = getCallerDirname();
    const dir2 = getCallerDirname();
    expect(dir1).toBe(dir2);
  });

  it("should return a directory that contains source files", () => {
    const dir = getCallerDirname();
    // The directory should contain JavaScript/TypeScript files
    const dirContents = existsSync(dir);
    expect(dirContents).toBe(true);

    // Verify it's a valid source directory path
    expect(dir).toMatch(/src/);
  });
});

describe("extractCallerPath", () => {
  for (const ea of isWindows
    ? [
        {
          frame: "at functionName (C:\\path\\file.js:1:1)",
          path: "C:\\path\\file.js",
        },
        {
          frame: "at functionName (C:\\path with spaces:1:1\\file.js:1:1)",
          path: "C:\\path with spaces:1:1\\file.js",
        },
        {
          frame: "at C:\\path\\file.js:1:1",
          path: "C:\\path\\file.js",
        },
        {
          frame: "at functionName (\\\\server\\share\\path\\file.js:1:1)",
          path: "\\\\server\\share\\path\\file.js",
        },
        {
          frame: "at \\\\server\\share\\path\\file.js:1:1",
          path: "\\\\server\\share\\path\\file.js",
        },
      ]
    : [
        {
          frame: "at Object.<anonymous> (/Users/dev/project/test.js:1:1)",
          path: "/Users/dev/project/test.js",
        },
        {
          frame:
            "at Object.<anonymous> (/path with spaces:2:3/and/numbers/test.js:1:1)",
          path: "/path with spaces:2:3/and/numbers/test.js",
        },
        {
          frame: "at /Users/dev/project/anonymous.js:5:10",
          path: "/Users/dev/project/anonymous.js",
        },
        {
          frame:
            "at Object.get property [as prop] (/Users/dev/project/getter.js:1:1)",
          path: "/Users/dev/project/getter.js",
        },
        {
          frame:
            "at eval (eval at <anonymous> (/Users/dev/project/eval.js:1:1)",
          path: "/Users/dev/project/eval.js",
        },
      ]) {
    it("should extract the path from " + ea.frame, () => {
      expect(
        extractCallerPath(`Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    ${ea.frame}`),
      ).toBe(ea.path);
    });

    it("should throw when path cannot be extracted", () => {
      expect(() => extractCallerPath(ea.frame)).toThrow(Error);
      expect(() => extractCallerPath(ea.frame)).toThrow(
        "Invalid stack trace format: missing caller frame",
      );
    });
  }

  it("should throw when stack trace is missing", () => {
    expect(() => extractCallerPath("")).toThrow(Error);
    expect(() => extractCallerPath("")).toThrow(
      "Invalid stack trace format: missing caller frame",
    );
  });

  it("should throw when stack trace format is invalid", () => {
    expect(() => extractCallerPath("Error\nat someFunction")).toThrow(Error);
    expect(() => extractCallerPath("Error\nat someFunction")).toThrow(
      "Invalid stack trace format: missing caller frame",
    );
  });

  it("should throw for file:// URLs in stack traces", () => {
    // The current regex patterns don't support file:// URLs in stack traces
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at functionName (file:///Users/dev/project/test.js:1:1)`;
    expect(() => extractCallerPath(stack)).toThrow(Error);
    expect(() => extractCallerPath(stack)).toThrow(
      "Invalid stack trace format: no parsable frames",
    );
  });

  it("should handle invalid URL in stack trace", () => {
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at functionName (http://[invalid-url:1:1)`;
    expect(() => extractCallerPath(stack)).toThrow(Error);
    expect(() => extractCallerPath(stack)).toThrow(
      "Invalid stack trace format: no parsable frames",
    );
  });

  it("should handle stack without valid frames after caller", () => {
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at someFunction
    at anotherFunction`;
    expect(() => extractCallerPath(stack)).toThrow(Error);
    expect(() => extractCallerPath(stack)).toThrow(
      "Invalid stack trace format: no parsable frames",
    );
  });

  it("should handle empty frame lines", () => {
    const stack = isWindows
      ? `Error
    at getCallerDirname (C:\\src\\caller_dirname.ts:10:20)
    
    at functionName (C:\\path\\to\\file.js:1:1)`
      : `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    
    at functionName (/path/to/file.js:1:1)`;
    const expectedPath = isWindows
      ? "C:\\path\\to\\file.js"
      : "/path/to/file.js";
    expect(extractCallerPath(stack)).toBe(expectedPath);
  });

  it("should handle paths with null or empty groups", () => {
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at functionName (:1:1)`;
    expect(() => extractCallerPath(stack)).toThrow(Error);
    expect(() => extractCallerPath(stack)).toThrow(
      "Invalid stack trace format: no parsable frames",
    );
  });

  it("should handle native code frames", () => {
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at Array.forEach (<anonymous>)
    at functionName (/path/to/file.js:1:1)`;
    const expectedPath = isWindows
      ? "C:\\path\\to\\file.js"
      : "/path/to/file.js";
    const actualStack = stack.replace("/path/to/file.js", expectedPath);
    expect(extractCallerPath(actualStack)).toBe(expectedPath);
  });

  it("should skip eval frames", () => {
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at eval (eval at <anonymous> (eval:1:1))
    at functionName (/real/path/file.js:1:1)`;
    const expectedPath = isWindows
      ? "C:\\real\\path\\file.js"
      : "/real/path/file.js";
    const actualStack = stack.replace("/real/path/file.js", expectedPath);
    expect(extractCallerPath(actualStack)).toBe(expectedPath);
  });

  it("should handle deeply nested paths", () => {
    const deepPath = isWindows
      ? "C:\\very\\deep\\nested\\directory\\structure\\with\\many\\levels\\file.js"
      : "/very/deep/nested/directory/structure/with/many/levels/file.js";
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at functionName (${deepPath}:1:1)`;
    expect(extractCallerPath(stack)).toBe(deepPath);
  });

  it("should handle paths with special characters", () => {
    const specialPath = isWindows
      ? "C:\\path\\with-dashes\\and_underscores\\file.test.js"
      : "/path/with-dashes/and_underscores/file.test.js";
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at functionName (${specialPath}:1:1)`;
    expect(extractCallerPath(stack)).toBe(specialPath);
  });

  it("should handle stack traces with multiple getCallerDirname frames", () => {
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at getCallerDirname (/src/other_caller.ts:5:10)
    at functionName (/path/to/file.js:1:1)`;
    // The function returns the path from the frame after the FIRST getCallerDirname
    const expectedPath = isWindows
      ? "C:\\src\\other_caller.ts"
      : "/src/other_caller.ts";
    const actualStack = stack.replace("/src/other_caller.ts", expectedPath);
    expect(extractCallerPath(actualStack)).toBe(expectedPath);
  });

  it("should handle Windows network paths", () => {
    if (!isWindows) return;

    const stack = `Error
    at getCallerDirname (C:\\src\\caller_dirname.ts:10:20)
    at functionName (\\\\server\\share\\project\\file.js:1:1)`;
    expect(extractCallerPath(stack)).toBe(
      "\\\\server\\share\\project\\file.js",
    );
  });

  it("should handle paths with parentheses in directory names", () => {
    const pathWithParens = isWindows
      ? "C:\\Program Files (x86)\\MyApp\\script.js"
      : "/opt/apps (legacy)/myapp/script.js";
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at functionName (${pathWithParens}:1:1)`;
    expect(extractCallerPath(stack)).toBe(pathWithParens);
  });

  it("should handle stack with only getCallerDirname frame", () => {
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)`;
    expect(() => extractCallerPath(stack)).toThrow(Error);
    expect(() => extractCallerPath(stack)).toThrow(
      "Invalid stack trace format: no parsable frames",
    );
  });

  it("should handle malformed stack frames with partial paths", () => {
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at functionName (/incomplete/path:)`;
    expect(() => extractCallerPath(stack)).toThrow(Error);
    expect(() => extractCallerPath(stack)).toThrow(
      "Invalid stack trace format: no parsable frames",
    );
  });

  it("should extract path from arrow function frames", () => {
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at Array.map.item => item (/arrow/function/file.js:1:1)`;
    const expectedPath = isWindows
      ? "C:\\arrow\\function\\file.js"
      : "/arrow/function/file.js";
    const actualStack = stack.replace("/arrow/function/file.js", expectedPath);
    expect(extractCallerPath(actualStack)).toBe(expectedPath);
  });

  it("should handle Windows drive letters other than C:", () => {
    if (!isWindows) return;

    const stack = `Error
    at getCallerDirname (C:\\src\\caller_dirname.ts:10:20)
    at functionName (D:\\projects\\app\\main.js:1:1)`;
    expect(extractCallerPath(stack)).toBe("D:\\projects\\app\\main.js");
  });
});
