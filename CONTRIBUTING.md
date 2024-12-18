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
