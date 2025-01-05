// src/types/hidden_metadata.ts

/**
 * Represents the detailed state of a file or directory's hidden attribute
 */
export interface HiddenMetadata {
  /**
   * Whether the item is considered hidden by any method
   */
  hidden: boolean;

  /**
   * Whether the item has a dot prefix (POSIX-style hidden). Windows doesn't
   * care about dot prefixes.
   */
  dotPrefix: boolean;

  /**
   * Whether the item has system hidden flags set, like via `chflags` on macOS
   * or on Windows via `GetFileAttributesW`
   */
  systemFlag: boolean;

  /**
   * Indicates which hiding methods are supported on the current platform
   */
  supported: {
    /**
     * Whether dot prefix hiding is supported on the current operating system
     */
    dotPrefix: boolean;

    /**
     * Whether system flag hiding is supported
     */
    systemFlag: boolean;
  };
}
