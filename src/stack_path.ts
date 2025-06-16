import { dirname } from "node:path";
import { isWindows } from "./platform";
import { isNotBlank, toS } from "./string";

export function getCallerDirname(): string {
  const e = new Error();
  if (e.stack == null) {
    Error.captureStackTrace(e);
  }
  return dirname(extractCallerPath(e.stack as string));
}

// CURSE THE ESM MODULE SYSTEM 💩 THIS IS ALL HORRIBLE

// THANK GOODNESS for tsup shims: this should only be used when running tests.

// Comprehensive regex patterns for different stack frame formats. Note that we
// only expect tests to have the first standard form, but if something's worth
// doing, **it's worth overdoing**.
const patterns = isWindows
  ? [
      // Standard: "at functionName (C:\path\file.js:1:1)"
      /\bat\s[^(]*\((?<path>[A-Z]:\\.+?):\d+:\d+\)$/,
      // direct: "at C:\path\file.js:1:1"
      /\bat\s(?<path>[A-Z]:\\.+?):\d+:\d+$/,
      // UNC: "at functionName (\\server\share\path\file.js:1:1)"
      /\bat\s[^(]*\((?<path>\\\\.+?):\d+:\d+\)$/,
      // direct: "at \\server\share\path\file.js:1:1"
      /\bat\s(?<path>\\\\.+?):\d+:\d+$/,
    ]
  : [
      // Standard: "at functionName (/path/file.js:1:1)"
      /\bat\s[^(]*\((?<path>\/.*?):\d+:\d+\)$/,
      // Anonymous or direct: "at /path/file.js:1:1"
      // eslint-disable-next-line security/detect-unsafe-regex -- parsing trusted Node.js stack traces, bounded by line anchors
      /\bat\s(?:[^/\s]+\s+)?(?<path>\/.*?):\d+:\d+$/,
    ];

const MaybeUrlRE = /^[a-z]{2,5}:\/\//i;

// only exposed for tests:
export function extractCallerPath(stack: string): string {
  const frames = stack.split("\n").filter(Boolean);

  // First find getCallerDirname() in the stack:
  const callerFrame = frames.findIndex((frame) =>
    frame.includes("getCallerDirname"),
  );
  if (callerFrame === -1) {
    throw new Error("Invalid stack trace format: missing caller frame");
  }
  for (let i = callerFrame + 1; i < frames.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- accessing array element by index in trusted array
    const frame = frames[i];
    for (const pattern of patterns) {
      const g = toS(frame).trim().match(pattern)?.groups;
      if (g != null && isNotBlank(g["path"])) {
        const path = g["path"];
        // Windows requires us to check if it's a reasonable URL, as URL accepts
        // "C:\\path\\file.txt" as valid (!!)
        if (MaybeUrlRE.test(path)) {
          try {
            return new URL(path).pathname;
          } catch {
            // ignore
          }
        }
        return path;
      }
    }
  }
  throw new Error("Invalid stack trace format: no parsable frames");
}
