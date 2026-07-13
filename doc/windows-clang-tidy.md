# Windows clang-tidy Support

## Status

Windows clang-tidy is a required, authoritative CI check. Diagnostics are not filtered: warnings
and errors in first-party code must be investigated rather than dismissed as MSVC-header noise.

## How it works

`scripts/clang-tidy.ts` generates a JSON compilation database that:

1. Locates the active Node.js, MSVC, and Windows SDK headers.
2. Uses the `arguments` array form so include paths containing spaces are passed verbatim.
3. Adds `src`—not `src/windows`—to the angle-bracket include path. This prevents
   `src/windows/string.h` from shadowing the CRT's `<string.h>`.
4. Applies the Windows checks in `src/windows/.clang-tidy` while inheriting the root project's
   first-party header filter.

If the MSVC or Windows SDK include directory cannot be found, compilation-database generation
fails. Continuing without those directories would create misleading cascades of missing `std`
members and hide whether first-party code was actually analyzed.

## Running it

```powershell
npm run lint:native
```

The script discovers LLVM's `clang-tidy.exe` in standard LLVM and Visual Studio locations, then
falls back to `clang-tidy` on `PATH`. Install LLVM if no supported executable is found.

## Troubleshooting

- Do not add message-text filtering for standard-library or missing-header diagnostics.
- Do not skip the Windows lint leg in CI.
- Verify that the generated `compile_commands.json` uses `arguments`, contains the selected MSVC
  and Windows SDK include directories, and uses `-I<checkout>\\src` rather than
  `-I<checkout>\\src\\windows`.
- If toolchain discovery fails, fix the discovered paths or runner installation instead of
  allowing analysis to continue with an incomplete compilation database.

See `doc/native-hardening.md` for the cross-platform analyzer rationale, enforced checks, header
filter design, and the failure modes that motivated this configuration.
