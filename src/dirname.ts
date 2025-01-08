import { getCallerDirname } from "./stack_path";

// Thanks to tsup shims, __dirname should always be defined except when run by
// jest (which will use the stack_path shim)
export function _dirname() {
  try {
    if (typeof __dirname !== "undefined") return __dirname;
  } catch {
    // ignore
  }
  // we must be in jest. Use the stack_path ~~hack~~ shim:
  return getCallerDirname();
}
