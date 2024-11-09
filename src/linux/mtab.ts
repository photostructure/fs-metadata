// src/linux/mtab.ts
import { readFile } from "node:fs/promises";
import { Config, getConfig } from "../Config";
import { OrDeepReadonly } from "../DeepFreeze";
import { compileGlob } from "../Glob";
import { decodeOctalEscapes } from "../Octal";

/**
 * Get list of mountpoints from /proc/mounts or /etc/mtab
 */
export async function readMtab(
  input = "/proc/mounts",
  config: OrDeepReadonly<Config> = getConfig(),
): Promise<string[]> {
  try {
    const excludedFsRE = compileGlob(config.excludedFilesystemTypes);
    const excludeRE = compileGlob(config.excludedMountpointGlobs);
    const mtabContent = await readFile(input, "utf8");
    const mountpoints = new Set<string>();

    for (let ea of mtabContent.split("\n")) {
      const line = ea.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const [fs, mp] = line.split(/\s+/);
      if (fs == null || mp == null || excludedFsRE.test(fs)) continue;

      const mountpoint = decodeOctalEscapes(mp);
      if (mountpoint.length === 0 || excludeRE.test(mountpoint)) continue;
      mountpoints.add(mountpoint);
    }
    return [...mountpoints].sort();
  } catch (error) {
    console.error("Error reading /etc/mtab:", error);
    throw error;
  }
}
