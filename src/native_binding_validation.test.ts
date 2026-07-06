// src/native_binding_validation.test.ts
//
// Argument validation at the native-binding boundary. Bad input must surface
// as a JS TypeError: a plain C++ exception escaping a N-API entry point is
// not translated by node-addon-api and aborts the whole process (SIGABRT).
// Regression coverage: getVolumeMetadata({ mountPoint: "" }) used to abort
// Node with exit code 134 on Linux.
//
// These tests deliberately load the native module directly (like src/index.ts
// does) so they exercise the native validation, not the TypeScript wrappers.

import NodeGypBuild from "node-gyp-build";
import { join } from "node:path";
import { _dirname } from "./dirname";
import type { NativeBindings } from "./types/native_bindings";

describe("native binding argument validation", () => {
  let bindings: NativeBindings;

  beforeAll(async () => {
    bindings = NodeGypBuild(join(_dirname(), "..")) as NativeBindings;
  });

  describe("getVolumeMetadata()", () => {
    it("throws a TypeError for an empty mountPoint", () => {
      expect(() => bindings.getVolumeMetadata({ mountPoint: "" })).toThrow(
        /mountPoint cannot be empty/,
      );
    });

    it("throws a TypeError for a missing mountPoint", () => {
      expect(() =>
        bindings.getVolumeMetadata({} as { mountPoint: string }),
      ).toThrow(/String expected for mountPoint/);
    });

    it("throws a TypeError for a non-string mountPoint", () => {
      expect(() =>
        bindings.getVolumeMetadata({
          mountPoint: 123,
        } as unknown as { mountPoint: string }),
      ).toThrow(/String expected for mountPoint/);
    });

    it("throws a TypeError when called without arguments", () => {
      expect(() =>
        (bindings.getVolumeMetadata as unknown as () => unknown)(),
      ).toThrow(/Expected options object/);
    });

    it("throws a TypeError for a negative timeoutMs", () => {
      // Uint32Value() used to wrap -1 into a ~50-day timeout
      expect(() =>
        bindings.getVolumeMetadata({ mountPoint: "/", timeoutMs: -1 }),
      ).toThrow(/timeoutMs/);
    });

    it("throws a TypeError for a timeoutMs above one day", () => {
      // mirrors the public DayMs cap in validateTimeoutMs()
      expect(() =>
        bindings.getVolumeMetadata({ mountPoint: "/", timeoutMs: 86_400_001 }),
      ).toThrow(/timeoutMs/);
    });
  });
});
