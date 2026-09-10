import { realpath } from "node:fs/promises";
import { getMountPointForPathImpl } from "./mount_point_for_path";
import { optionsWithDefaults } from "./options";
import { isMacOS } from "./platform";
import type { NativeBindingsFn } from "./types/native_bindings";
import { getVolumeMetadataForPathImpl } from "./volume_metadata";

describe("path-resolution timeout boundary", () => {
  const unexpectedNativeCall = () => {
    throw new Error("only native path resolution may be reached");
  };
  const nativeFn: NativeBindingsFn = async () => {
    if (isMacOS) {
      return {
        getMountPoint: () => new Promise<string>(() => {}),
        setDebugLogging: unexpectedNativeCall,
        setDebugPrefix: unexpectedNativeCall,
        isHidden: unexpectedNativeCall,
        setHidden: unexpectedNativeCall,
        getVolumeMountPoints: unexpectedNativeCall,
        getVolumeMetadata: unexpectedNativeCall,
      };
    }
    throw new Error("native bindings must not be reached");
  };
  const blockedRealpath = (() =>
    new Promise<string>(() => {})) as unknown as typeof realpath;
  const opts = optionsWithDefaults({ timeoutMs: 20 });

  it("starts getMountPointForPath()'s timeout before path resolution", async () => {
    await expect(
      getMountPointForPathImpl("/blocked", opts, nativeFn, blockedRealpath),
    ).rejects.toThrow(/timeout/i);
  });

  it("starts getVolumeMetadataForPath()'s timeout before path resolution", async () => {
    await expect(
      getVolumeMetadataForPathImpl("/blocked", opts, nativeFn, blockedRealpath),
    ).rejects.toThrow(/timeout/i);
  });
});
