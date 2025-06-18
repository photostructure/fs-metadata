# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

@photostructure/fs-metadata - Cross-platform native Node.js module for filesystem metadata retrieval.

### Directory Structure
- `src/` - Source code (TypeScript and C++)
- `dist/` - Compiled JavaScript output (gitignored)
- `doc/` - Static documentation (manually written, checked into git)
- `build/` - All build artifacts (gitignored)
  - `build/docs/` - Generated API documentation from TypeDoc (deployed to GitHub Pages)
- `scripts/` - Build and utility scripts
- `prebuilds/` - Prebuilt native binaries for different platforms

### Script Preferences
**Always** use TypeScript (`.ts`) scripts executed with `tsx` instead of:
- `.js` scripts (require compilation or older Node.js syntax)
- `.mjs` scripts (ESM-only, compatibility issues)
- `.cjs` scripts (CommonJS-only, less type safety)

TypeScript with tsx provides type safety, modern syntax, and seamless execution.

## Critical Knowledge

### Testing File System Metadata
**Never** expect exact equality for dynamic values (`available`, `used`) between calls. Only verify:
- Value exists and has correct type: `typeof result.available === 'number'`
- Test static properties (`size`, `mountFrom`, `fstype`) for exact equality
- Avoid range assertions (`available > 0`) - file changes can be dramatic

### Cross-Module Compatibility
Use `_dirname()` from `./dirname` instead of `__dirname` - works in both CommonJS and ESM contexts.

### Node.js Version Compatibility
Jest 30 doesn't support Node.js 23. Use Node.js 20, 22, or 24.

## Windows-Specific Issues

### Build Architecture Issue
**Problem**: "No Target Architecture" error from Windows SDK headers when building with node-gyp/prebuildify.

**Solution**: Use `scripts/prebuildify-wrapper.ts` which sets the `CL` environment variable with architecture defines:
- For x64: `CL=/D_M_X64 /D_WIN64 /D_AMD64_`
- For ARM64: `CL=/D_M_ARM64 /D_WIN64`

**Why This is Necessary**:
- Prebuildify doesn't properly pass architecture defines from binding.gyp conditions
- The Windows SDK requires these macros before including `<windows.h>`
- Projects like node-sqlite avoid this by not using Windows headers directly

**Why Other Approaches Failed**:
- **Source file defines**: Would hardcode x64 defines, breaking ARM64 builds
- **windows_compat.h wrapper**: Can't distinguish x64 from ARM64 at compile time
- **binding.gyp conditions**: Not evaluated properly by prebuildify
- **msvs_settings defines**: Not passed through to the compiler

### Memory Testing Limitations
Traditional Windows tools **do not work** with Node.js native modules:
- **Dr. Memory**: Fails with "Unable to load client library: ucrtbase.dll"
- **Debug CRT builds**: Cannot be loaded by Node.js (missing debug runtime + UNC path issues)
- **Visual Leak Detector**: Requires debug builds which don't work
- **Application Verifier**: Cannot hook into Node.js memory management

Use JavaScript-based memory testing (`src/windows-memory-check.test.ts`) instead.

### Static Analysis (clang-tidy) Limitations
**clang-tidy on Windows** has limited effectiveness due to MSVC header incompatibility:

- Generates many false errors about missing std namespace members
- Still provides valuable warnings about your code
- See `doc/windows-clang-tidy.md` for details
- Consider using Visual Studio Code Analysis as an alternative

### WSL Development
Run Windows commands from WSL:
```bash
cmd.exe /c "cd C:\\Users\\matth\\src\\fs-metadata && npm test"
# Or create helper: echo 'cmd.exe /c "cd C:\\Users\\matth\\src\\fs-metadata && $@"' > ~/bin/win-run
```

## Memory Leak Detection

Run `npm run check:memory` for comprehensive platform-specific testing:
- **All platforms**: JavaScript memory tests with GC triggers
- **Windows**: Handle count monitoring via `process.report`
- **Linux**: Valgrind + AddressSanitizer/LeakSanitizer
- **macOS**: AddressSanitizer (may fail due to SIP - expected)

## CI/CD Test Reliability

### Critical Anti-Patterns
**Never** use these to "fix" async issues:
```javascript
// BAD: Arbitrary timeouts
await new Promise(resolve => setTimeout(resolve, 100));
// BAD: Forcing GC
if (global.gc) global.gc();
// BAD: setImmediate in afterAll
afterAll(async () => {
  await new Promise(resolve => setImmediate(resolve));
});
```

### Windows Directory Cleanup
Always use retry logic:
```typescript
await fsp.rm(tempDir, {
  recursive: true,
  force: true,
  maxRetries: process.platform === "win32" ? 3 : 1,
  retryDelay: process.platform === "win32" ? 100 : 0,
});
```

### Platform Performance Multipliers
- Alpine Linux (musl): 2x slower
- ARM64 emulation: 5x slower
- Windows processes: 4x slower
- macOS VMs: 4x slower

### Multi-Process Synchronization
Use explicit signals:
```javascript
console.log("READY");  // Signal readiness
console.log("RESULT:" + outcome);  // Signal result
```

## Release Process

Requires repository secrets:
- `NPM_TOKEN`: npm authentication
- `GPG_PRIVATE_KEY`: ASCII-armored GPG key
- `GPG_PASSPHRASE`: GPG passphrase

Automated via GitHub Actions workflow dispatch or manual:
```bash
npm run prepare-release
git config commit.gpgsign true
npm version patch|minor|major
npm publish
git push origin main --follow-tags
```