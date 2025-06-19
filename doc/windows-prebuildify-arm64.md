# Windows ARM64 Development and Prebuildify Setup

This document provides guidance for Windows ARM64 native module development, prebuildify configuration, and troubleshooting common issues.

## Overview

Windows ARM64 support for native Node.js modules is a rapidly evolving area. This document captures key learnings from investigating build failures and researching the ecosystem.

## Prebuildify Architecture Support

### How Prebuildify Works

1. **Build Time**: Creates prebuilt binaries for different platforms/architectures
2. **Package Time**: Stores binaries in `./prebuilds/[platform]-[arch]/`
3. **Runtime**: Uses `node-gyp-build` to load the appropriate binary

### Platform Naming Conventions

- Windows x64: `win32-x64`
- Windows ARM64: `win32-arm64`
- Linux x64: `linux-x64`
- macOS x64: `darwin-x64`
- macOS ARM64: `darwin-arm64`

### Scoped Package Handling

For scoped npm packages like `@photostructure/fs-metadata`:

- Package scope uses `+` instead of `/` in filenames
- Example: `@photostructure+fs-metadata.glibc.node`
- This is standard prebuildify behavior

## Windows ARM64 Specific Considerations

### Current State of the Ecosystem (2025)

1. **GitHub Actions Support**: Windows ARM64 runners are in public preview

   - Free for public repositories
   - Run Windows 11 Desktop image
   - Native ARM64 compilation (no emulation)

2. **Common Issues in Other Projects**:
   - **Cypress**: Requires manual addition of "win32-arm64" as valid OS
   - **LMDB-JS**: Reports "No native build was found for platform=win32 arch=arm64"
   - **Cloudflare workerd**: Requires manual workarounds in install scripts
   - Many projects fall back to x64 binaries (run via emulation)

### Architecture Detection Challenges

Windows SDK headers require architecture-specific defines before including `<windows.h>`:

- x64: `/D_M_X64 /D_WIN64 /D_AMD64_`
- ARM64: `/D_M_ARM64 /D_WIN64`

Our solution: Set `CL` environment variable in build scripts (see `scripts/prebuildify-wrapper.ts`)

## GitHub Actions Configuration

### Best Practices

```yaml
prebuild-win-arm64:
  runs-on: windows-11-arm # Native ARM64 runner
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: "npm"
    - run: npm ci --ignore-scripts
    - run: npm run build:native
    - uses: actions/upload-artifact@v4
      with:
        name: prebuilds-windows-11-arm
        path: prebuilds/
```

### Testing Configuration

```yaml
test-win-arm64:
  needs: [prebuild-win-arm64]
  runs-on: windows-11-arm
  steps:
    - uses: actions/download-artifact@v4
      with:
        path: ./prebuilds
        merge-multiple: true
    - run: npm ci
    - run: npm run tests
```

## Common Problems and Solutions

### Problem: Jest Worker Process Failures

**Symptoms**:

- "Jest worker encountered 4 child process exceptions, exceeding retry limit"
- Tests fail only in CI, not locally

**Root Causes**:

1. Module resolution differs in worker threads
2. `__dirname` context changes in Jest environment
3. Relative paths may not resolve correctly

**Solutions**:

1. Use multiple fallback paths when loading native modules
2. Try `process.cwd()` in addition to relative paths
3. Ensure prebuilds are in expected locations

### Problem: Native Module Not Found

**Symptoms**:

- "No native build was found for platform=win32 arch=arm64"
- Module loads on x64 but not ARM64

**Root Causes**:

1. Missing prebuilt binary for the platform
2. Incorrect platform detection
3. node-gyp-build not finding the prebuild

**Solutions**:

1. Verify prebuild exists in `prebuilds/win32-arm64/`
2. Check that `process.platform` === "win32" and `process.arch` === "arm64"
3. Use `node-gyp-build` diagnostic output to debug loading

### Problem: Build Failures on Windows ARM64

**Symptoms**:

- "No Target Architecture" errors
- Windows SDK header compilation errors

**Root Causes**:

- Missing architecture defines for Windows SDK
- Prebuildify not passing through defines from binding.gyp

**Solution**:
Set environment variables before building:

```javascript
if (process.platform === "win32" && process.arch === "arm64") {
  process.env.CL = "/D_M_ARM64 /D_WIN64";
}
```

## Testing Strategies

### 1. Memory Testing

Traditional Windows memory tools don't work with Node.js:

- Dr. Memory: "Unable to load client library"
- Debug CRT: Cannot be loaded by Node.js
- Visual Leak Detector: Requires debug builds

Use JavaScript-based testing instead (see `src/windows-memory-check.test.ts`)

### 2. Worker Thread Testing

- Test native module loading in both main and worker threads
- Use integration tests, not mocks
- Verify actual functionality, not just loading

### 3. Cross-Platform Testing

- Test on actual ARM64 hardware when possible
- Use GitHub Actions for CI testing
- Be aware of performance differences (ARM64 can be slower)

## Debugging Tips

### 1. Verify Prebuild Location

```bash
# List prebuilds
ls -la prebuilds/

# Check specific platform
ls -la prebuilds/win32-arm64/
```

### 2. Test Native Module Loading

```javascript
// test-native-load.js
const nodeGypBuild = require("node-gyp-build");
try {
  const binding = nodeGypBuild(process.cwd());
  console.log("✓ Native module loaded");
  console.log("Functions:", Object.keys(binding));
} catch (error) {
  console.error("✗ Failed to load:", error.message);
}
```

### 3. Check Process Information

```javascript
console.log("Platform:", process.platform);
console.log("Architecture:", process.arch);
console.log("Node version:", process.version);
```

## Future Considerations

1. **Windows ARM64 Adoption**: Expected to grow with Qualcomm-based laptops
2. **Tooling Improvements**: Build tools catching up with ARM64 support
3. **Performance**: Native ARM64 binaries avoid x64 emulation overhead
4. **Testing**: More ARM64 CI runners becoming available

## References

- [Prebuildify Documentation](https://github.com/prebuild/prebuildify)
- [Node-gyp-build](https://github.com/prebuild/node-gyp-build)
- [Windows ARM64 GitHub Actions](https://github.blog/changelog/2025-04-14-windows-arm64-hosted-runners-now-available-in-public-preview/)
- [Node.js Native Addons](https://nodejs.org/api/addons.html)
- [Windows on ARM Documentation](https://docs.microsoft.com/en-us/windows/arm/)

## Related Files

- `scripts/prebuildify-wrapper.ts` - Handles architecture-specific build configuration
- `scripts/install.cjs` - Sets up environment for Windows builds
- `.github/workflows/build.yml` - CI configuration including ARM64 jobs
- `CLAUDE.md` - Project-specific build notes
