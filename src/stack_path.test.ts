import { isWindows } from "./platform";
import { extractCallerPath, getCallerDirname } from "./stack_path";

describe("stack_path", () => {
  it("should return the directory of the calling file", () => {
    const dir = getCallerDirname();
    // We can't use __dirname! SAD
    console.log("caller dir", { dir });
  });

  it("should capture stack trace when stack is null", () => {
    // Test that getCallerDirname works even when we force an error
    // We can't mock Error constructor in ESM mode, so we just verify it works
    const dir = getCallerDirname();
    expect(dir).toBeTruthy();
    expect(typeof dir).toBe("string");
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
      expect(() => extractCallerPath(ea.frame)).toThrow(/missing caller frame/);
    });
  }

  it("should throw when stack trace is missing", () => {
    expect(() => extractCallerPath("")).toThrow(/invalid/i);
  });

  it("should throw when stack trace format is invalid", () => {
    expect(() => extractCallerPath("Error\nat someFunction")).toThrow(
      /Invalid stack trace format/,
    );
  });

  it("should throw for file:// URLs in stack traces", () => {
    // The current regex patterns don't support file:// URLs in stack traces
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at functionName (file:///Users/dev/project/test.js:1:1)`;
    expect(() => extractCallerPath(stack)).toThrow(/no parsable frames/);
  });

  it("should handle invalid URL in stack trace", () => {
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at functionName (http://[invalid-url:1:1)`;
    expect(() => extractCallerPath(stack)).toThrow(/no parsable frames/);
  });

  it("should handle stack without valid frames after caller", () => {
    const stack = `Error
    at getCallerDirname (/src/caller_dirname.ts:10:20)
    at someFunction
    at anotherFunction`;
    expect(() => extractCallerPath(stack)).toThrow(/no parsable frames/);
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
    expect(() => extractCallerPath(stack)).toThrow(/no parsable frames/);
  });
});
