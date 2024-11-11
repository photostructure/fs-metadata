// src/linux/mtab.ts
import { readFile } from "node:fs/promises";
import { decodeOctalEscapes } from "../Octal.js";
import { TypedMountPoint } from "../TypedMountPoint.js";

function hasContent(s: string | undefined | null): s is string {
  return s != null && s.trim().length > 0;
}
/**
 * Get list of mount points from /proc/mounts or /etc/mtab
 */
export async function getLinuxMountPoints(
  input = "/proc/mounts",
): Promise<TypedMountPoint[]> {
  try {
    const mtabContent = await readFile(input, "utf8");
    const result: { mountPoint: string; fstype: string }[] = [];

    for (const ea of mtabContent.split("\n")) {
      const line = ea.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const [fstype, mp] = line.split(/\s+/);
      const mountPoint = decodeOctalEscapes(mp ?? "");
      if (hasContent(fstype) && hasContent(mountPoint)) {
        result.push({ mountPoint, fstype });
      }
    }
    return result;
  } catch (error) {
    console.error("Error reading " + input + ":" + error);
    throw error;
  }
}
