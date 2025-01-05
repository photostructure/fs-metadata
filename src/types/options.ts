// src/types/options.ts

/**
 * Configuration options for filesystem operations.
 *
 * @see {@link optionsWithDefaults} for creating an options object with default values
 * @see {@link OptionsDefault} for the default values
 */
export interface Options {
  /**
   * Timeout in milliseconds for filesystem operations.
   *
   * Disable timeouts by setting this to 0.
   *
   * @see {@link TimeoutMsDefault}.
   */
  timeoutMs: number;

  /**
   * Maximum number of concurrent filesystem operations.
   *
   * Defaults to {@link https://nodejs.org/api/os.html#osavailableparallelism | availableParallelism}.
   */
  maxConcurrency: number;

  /**
   * On Linux and macOS, mount point pathnames that matches any of these glob
   * patterns will have {@link MountPoint.isSystemVolume} set to true.
   *
   * @see {@link SystemPathPatternsDefault} for the default value
   */
  systemPathPatterns: string[];

  /**
   * On Linux and macOS, volumes whose filesystem matches any of these strings
   * will have {@link MountPoint.isSystemVolume} set to true.
   *
   * @see {@link SystemFsTypesDefault} for the default value
   */
  systemFsTypes: string[];

  /**
   * On Linux, use the first mount point table in this array that is readable.
   *
   * @see {@link LinuxMountTablePathsDefault} for the default values
   */
  linuxMountTablePaths: string[];

  /**
   * Should system volumes be included in result arrays? Defaults to true on
   * Windows and false elsewhere.
   */
  includeSystemVolumes: boolean;
}
