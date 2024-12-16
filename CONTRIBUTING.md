# Howdy!

Contributions are welcome! Please feel free to submit a Pull Request.

For major changes, please open an issue first to discuss what you would like to change.

Please make sure to update tests and documentation as appropriate.

## Building from Source

Requirements:

- Node.js (supported version)
- Python 3
- Platform-specific C++ build tools:
  - Windows: Visual Studio Build Tools
  - macOS: Xcode Command Line Tools
  - Linux: GCC and development headers

## Before submitting your PR

Run `npm run precommit`, which:

- re-formats your code,
- runs the linter
- compiles the native and typescript code, and finally
- runs all the tests

Keep in mind: this project's build matrix is _extensive_--be sure any edit takes
into account both Windows and POSIX systems.

- macOS on x86 and Apple Silicon
- Windows on x64
- glibc Linux on x64 and arm64, with or without Gnome GIO support
- MUSL Alpine Linux on x64 and arm64

