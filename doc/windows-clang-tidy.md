# Windows clang-tidy Support

## Status

clang-tidy has limited support on Windows due to fundamental incompatibilities between clang and MSVC headers. While we've implemented Windows support in our unified `scripts/clang-tidy.ts`, users should be aware of the limitations.

## Current Implementation

1. **Unified Script**: `scripts/clang-tidy.ts` works on all platforms including Windows
2. **Automatic Detection**: Finds Node.js headers, MSVC includes, and Windows SDK paths
3. **Configuration**: Windows-specific checks in `src/windows/.clang-tidy`
4. **Fallback**: Minimal configuration (`.clang-tidy-windows-minimal`) for basic checks

## Known Issues

### Header Compatibility

- clang-tidy cannot fully parse MSVC STL headers, resulting in errors like:
  - `no member named 'max' in namespace 'std'`
  - `unknown type name 'namespace'`
  - `no template named 'pointer_traits'`

### Root Cause

- MSVC headers use Microsoft-specific extensions that clang doesn't fully support
- Node.js native addon headers add additional complexity
- Even with clang-cl mode, full compatibility isn't achieved

## Recommendations

### For Windows Developers

1. **Use Visual Studio Code Analysis**: The built-in Code Analysis in Visual Studio provides better Windows-specific checking
2. **Focus on Warnings**: Despite header errors, clang-tidy still catches many issues:
   - Uninitialized variables
   - RAII violations
   - Member initialization issues
   - Ownership problems

3. **Run Anyway**: Even with errors, the warnings are valuable:
   ```bash
   npm run lint:native
   ```

### For CI/CD

Consider skipping clang-tidy on Windows in CI to avoid noise:

```bash
# In CI scripts
if [ "$OS" != "Windows_NT" ]; then
  npm run lint:native
fi
```

## Future Improvements

- Monitor clang-tidy development for better MSVC support
- Consider using Visual Studio's built-in clang-tidy integration
- Investigate using `clangd` as an alternative

## What Still Works

Despite the header issues, clang-tidy on Windows can still detect:

- Uninitialized variables
- Missing RAII usage
- Resource leaks in your code (not system headers)
- Code style issues
- Many security vulnerabilities

The key is to focus on warnings in your own code files, not system header errors.
