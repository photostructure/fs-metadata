import { debuglog, format } from "node:util";
import { defer } from "./defer.js";

// allow tests to reset the debug log context

export const debugLogContext = defer(() => {
  for (const ea of ["fs-metadata", "fs-meta"]) {
    if (debuglog(ea).enabled) {
      return ea;
    }
    if (debuglog(ea.toUpperCase()).enabled) {
      return ea;
    }
  }
  return "photostructure:fs-metadata";
});

export const isDebugEnabled = defer(() => {
  return debuglog(debugLogContext()).enabled ?? false;
});

export function debug(msg: string, ...args: unknown[]) {
  if (!isDebugEnabled()) return;
  const now = new Date();

  // Format: [HH:MM:SS.mmm] prefix: message
  const timestamp = `[${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}.${now.getMilliseconds().toString().padStart(3, "0")}] ${debugLogContext()} `;

  process.stderr.write(timestamp + format(msg, ...args) + "\n");
}
