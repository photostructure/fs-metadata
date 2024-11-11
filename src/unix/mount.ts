// src/unix/mount.ts

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { TypedMountPoint } from "../TypedMountPoint.js";

const execAsync = promisify(exec);

interface MountPoint extends TypedMountPoint {
  device: string;
  options: string[];
}

const isLinux = process.platform === "linux";
const isDarwin = process.platform === "darwin";

/**
 * Gets the list of mount points using the `mount` command
 *
 * Only for Linux and macOS. Included only for tests: use `getVolumeMountPoints` instead.
 */
export async function execAndParseMount(): Promise<MountPoint[]> {
  if (!isLinux && !isDarwin) throw new Error("Unsupported platform");

  try {
    const { stdout } = await execAsync("mount");

    return stdout
      .trim()
      .split("\n")
      .map((line) => {
        if (isLinux) {
          // Linux format: device on path type type (options)
          const regex = /^(.+?) on (.+?) type ([^ ]+) \((.+?)\)$/;
          const match = line.match(regex);
          if (!match) return null;

          const [, device, mountPoint, type, optionsStr] = match;
          return {
            mountPoint: mountPoint.trim(),
            device: device.trim(),
            fstype: type.trim(),
            options: optionsStr?.split(",").map((opt) => opt.trim()) ?? [],
          };
        } else if (isDarwin) {
          // macOS format: device on path (type, options)
          const regex = /^(.+?) on (.+?) \(([^,]+?)(,\s*(.+))?\)$/;
          const match = line.match(regex);
          if (!match) return null;

          const [, device, mountPoint, type, , optionsStr] = match;
          return {
            mountPoint: mountPoint.trim(),
            device: device.trim(),
            fstype: type.trim(),
            options: optionsStr?.split(",").map((opt) => opt.trim()) ?? [],
          };
        } else {
          throw new Error("Unsupported platform");
        }
      })
      .filter((mount): mount is MountPoint => mount !== null);
  } catch (error) {
    throw new Error(
      `Failed to get mount points: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
