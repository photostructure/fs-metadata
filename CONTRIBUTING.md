# Contributing

Pull request contributions are welcome!

For major changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests and documentation as appropriate.

## Building from Source

### On Windows

When installing Node.js, on the "Tools for Native Modules" page, be sure to
["Automatically install the necessary
tools"](https://photostructure.com/server/photostructure-for-node/#step-2-install-nodejs).

Also, in an Administrator PowerShell, run:

    choco install llvm

### On macOS

Install the Xcode Command Line Tools, and then

    brew install clang-format

### On Ubuntu/Debian

    sudo apt-get install build-essential clang-format libglib2.0-dev libblkid-dev uuid-dev

## Before submitting your PR

Run `npm run precommit`, which:

- reformats your code
- runs the linter
- compiles the native and typescript code, and finally
- runs all the tests

Keep in mind: this project's build matrix is _extensive_--be sure any edit takes
into account both Windows and POSIX systems.

- macOS on x86 and Apple Silicon
- Windows on x64
- glibc Linux on x64 and arm64, with or without Gnome GIO support
- MUSL Alpine Linux on x64 and arm64

## Development Gotchas

### Windows Shell Parsing in npm Scripts

**Problem**: npm scripts containing Unix shell operators like `||` with complex commands will fail on Windows with syntax errors like `$' was unexpected at this time.`

**Why**: Windows Command Prompt/PowerShell parses the entire command line before execution, including the Unix-specific parts that would never run on Windows. Even though constructs like `node scripts/is-platform.mjs win32 || <unix-command>` would exit early on Windows, the shell still tries to parse the syntax after `||`.

**Solution**: For platform-specific npm scripts that use shell operators:
- Create a wrapper Node.js script that handles platform detection internally (see `scripts/clang-tidy.mjs`)
- The wrapper can use `process.platform` or `os.platform()` to detect Windows and exit early
- Unix-specific commands can then be spawned using `child_process.spawn()` with `sh -c`

**Example**: The `clang-tidy` npm script was moved from:
```json
"clang-tidy": "node scripts/is-platform.mjs win32 || (npm run configure && bear -- npm run node-gyp-rebuild && find src -name '*.cpp' -o -name '*.h' | grep -E '\\.(cpp|h)$' | grep -v -E '(windows|darwin)/' | xargs clang-tidy)"
```

To:
```json
"clang-tidy": "node scripts/clang-tidy.mjs"
```

Where the script handles platform detection and command execution internally.
