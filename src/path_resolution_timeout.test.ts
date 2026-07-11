import { realpath } from "node:fs/promises";
import { getMountPointForPathImpl } from "./mount_point_for_path";
import { optionsWithDefaults } from "./options";
import type { NativeBindingsFn } from "./types/native_bindings";
import { getVolumeMetadataForPathImpl } from "./volume_metadata";

describe("path-resolution timeout boundary", () => {
  const nativeFn: NativeBindingsFn = () => {
    throw new Error("native bindings must not be reached");
  };
  const blockedRealpath = (() =>
    new Promise<string>(() => {})) as unknown as typeof realpath;
  const opts = optionsWithDefaults({ timeoutMs: 1 });

  it("starts getMountPointForPath()'s timeout before realpath", async () => {
    await expect(
      getMountPointForPathImpl("/blocked", opts, nativeFn, blockedRealpath),
    ).rejects.toThrow(/timeout/i);
  });

  it("starts getVolumeMetadataForPath()'s timeout before realpath", async () => {
    await expect(
      getVolumeMetadataForPathImpl("/blocked", opts, nativeFn, blockedRealpath),
    ).rejects.toThrow(/timeout/i);
  });
});
