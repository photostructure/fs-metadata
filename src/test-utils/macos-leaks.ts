/** Minimal native workload for `leaks --atExit` on macOS. */

import NodeGypBuild from "node-gyp-build";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { _dirname } from "../dirname";

interface MountPoint {
  mountPoint: string;
}

interface Binding {
  getVolumeMountPoints(): Promise<MountPoint[]>;
  getVolumeMetadata(options: { mountPoint: string }): Promise<unknown>;
}

const binding = NodeGypBuild(join(_dirname(), "..")) as Binding;

async function main(): Promise<void> {
  let mountPoints: MountPoint[] = [];
  for (let i = 0; i < 100; i++) {
    mountPoints = await binding.getVolumeMountPoints();
  }

  assert.ok(mountPoints.length > 0, "expected at least one mount point");
  const mountPoint = mountPoints[0]?.mountPoint;
  assert.ok(mountPoint, "expected a non-empty mount point path");
  for (let i = 0; i < 10; i++) {
    await binding.getVolumeMetadata({ mountPoint });
  }

  console.log("MACOS_LEAKS_OK");
}

void main().catch((error: unknown) => {
  console.error("macOS leaks workload failed:", error);
  process.exitCode = 1;
});
