# Windows ARM64 Security Configuration

## Overview

This document explains the security compilation flags used for ARM64 builds on Windows and why certain x64-specific flags are intentionally omitted.

## ARM64 Security Flags in binding.gyp

### Compiler Flags (`VCCLCompilerTool`)

#### `/guard:cf` - Control Flow Guard ✅ ENABLED

- **Supported**: Yes, ARM64 supports Control Flow Guard
- **Purpose**: Prevents exploitation of memory corruption vulnerabilities
- **Status**: Fully supported on ARM64 Windows since Windows 10

#### `/ZH:SHA_256` - Hash Algorithm ✅ ENABLED

- **Supported**: Yes, platform-independent
- **Purpose**: Specifies SHA-256 hash algorithm for file checksums
- **Status**: Standard security practice across all architectures

#### `/sdl` - Security Development Lifecycle ✅ ENABLED

- **Supported**: Yes, platform-independent
- **Purpose**: Enables additional compile-time security checks
- **Status**: Recommended for all builds

### Linker Flags (`VCLinkerTool`)

#### `/guard:cf` - Control Flow Guard at Link Time ✅ ENABLED

- **Supported**: Yes, ARM64 supports CFG
- **Purpose**: Enables CFG checks during linking
- **Status**: Must match compiler flag

#### `/DYNAMICBASE` - ASLR ✅ ENABLED

- **Supported**: Yes, ARM64 supports ASLR
- **Purpose**: Address Space Layout Randomization
- **Status**: Critical security feature, enabled on all architectures

## Flags Enabled on ARM64 (previously, and incorrectly, omitted)

### `/Qspectre` - Spectre Mitigation ✅ ENABLED

**This document previously claimed `/Qspectre` was "x64/x86-specific and not available for
ARM64". That was wrong, and it left the ARM64 build under-hardened against Spectre v1.**

- Microsoft documents `/Qspectre` for processors from "Intel, AMD, **and ARM**", with
  ARM/ARM64 support added in **Visual Studio 2017 15.7**.
- Spectre-mitigated **libraries** ship for x86, x64, ARM and ARM64.
- `/Qspectre` does **not** require the Spectre-mitigated CRT libs to be installed in order to
  compile or link. Verified: a VS 2022 install with no `lib\x64\spectre` directory builds and
  links the x64 addon with `/Qspectre` and emits no diagnostic.
- **Reference**: [Microsoft Learn — `/Qspectre`](https://learn.microsoft.com/en-us/cpp/build/reference/qspectre)

`/Qspectre` is therefore set for **all** Windows architectures in `binding.gyp`.

### `/HIGHENTROPYVA` - 64-bit ASLR ✅ APPLIES TO ARM64

Also not x64-specific: `/HIGHENTROPYVA` is enabled by default for **any 64-bit image**,
including ARM64, and is simply ignored for 32-bit images. It is passed on all arches.

## Flags Intentionally Omitted for ARM64

### `/CETCOMPAT` - Control-flow Enforcement Technology ❌ NOT AVAILABLE

**Why omitted**: Intel CET is x64-specific and not available for ARM64

- **Intel CET**: Hardware-based control-flow integrity (shadow stack)
- **x64 status**: Available on recent Intel CPUs (11th gen+)
- **ARM64 alternative**: `/guard:signret` emits PAC-based signed returns
- **Reference**: [Microsoft Learn — Enable Signed Returns](https://learn.microsoft.com/en-us/cpp/build/reference/c-cpp-prop-page?view=msvc-170#enable-signed-returns)

## ARM64-Specific Security Features

ARM64 does not support the x64 `/CETCOMPAT` flag. The build instead enables the controls that
MSVC exposes for this target:

### 1. Signed returns (PAC) ✅ ENABLED

- `/guard:signret` signs and authenticates return addresses
- Protects the backward edge of the call graph on supported ARM64 hardware
- **Status**: Enabled in the ARM64 compiler configuration

### 2. Control Flow Guard ✅ ENABLED

- `/guard:cf` instruments indirect calls and emits the linker metadata required by Windows CFG
- Protects the forward edge of the call graph
- **Status**: Enabled at both compile and link time

### 3. BTI and MTE ⚠️ NOT CLAIMED

- The addon does not pass a separately verified MSVC option for Branch Target Identification
  (BTI) or Memory Tagging Extension (MTE).
- Hardware capability alone does not mean the emitted addon uses a mitigation, so neither is
  credited in this build's security posture.

## Comparison: x64 vs ARM64 Security

| Feature            | x64                 | ARM64                   | Notes                              |
| ------------------ | ------------------- | ----------------------- | ---------------------------------- |
| Forward-edge CFI   | ✅ `/guard:cf`      | ✅ `/guard:cf`          | Compiler and linker, both arches   |
| Return protection  | ✅ `/CETCOMPAT`     | ✅ `/guard:signret`     | Different architecture mechanisms  |
| ASLR               | ✅ `/DYNAMICBASE`   | ✅ `/DYNAMICBASE`       | Same flag, both arches             |
| 64-bit ASLR        | ✅ `/HIGHENTROPYVA` | ✅ `/HIGHENTROPYVA`     | Applies to any 64-bit image        |
| DEP                | ✅ `/NXCOMPAT`      | ✅ `/NXCOMPAT`          | Same flag, both arches             |
| Spectre mitigation | ✅ `/Qspectre`      | ✅ `/Qspectre`          | ARM64 supported since VS 2017 15.7 |
| BTI / MTE          | —                   | Not enabled or verified | No protection claimed              |

## Build Configuration

### Current ARM64 Flags (binding.gyp)

```json
{
  "target_arch=='arm64'": {
    "defines": ["_M_ARM64", "_WIN64"],
    "msvs_settings": {
      "VCCLCompilerTool": {
        "AdditionalOptions": ["/guard:signret"]
      }
    }
  }
}
```

That architecture condition is merged with the shared Windows settings, so the effective ARM64
configuration is:

- Compiler: `/std:c++20`, `/guard:cf`, `/guard:signret`, `/Qspectre`, `/ZH:SHA_256`, `/sdl`
- Linker: `/guard:cf`, `/DYNAMICBASE`, `/HIGHENTROPYVA`, `/NXCOMPAT`
- Defines: `_M_ARM64`, `_WIN64`

`/CETCOMPAT` is x64-only and intentionally absent; `/guard:signret` supplies the ARM64 return
protection configured for this target.

### Security Posture

✅ **Current**: ARM64 builds enable architecture-appropriate compiler and linker mitigations

- Shared CFG, Spectre, ASLR, DEP, and SDL controls are enabled on both architectures
- ARM64 signed returns are enabled explicitly instead of crediting unconfigured hardware features
- Artifact-level security properties still require inspection on the target architecture

⏳ **Future Improvements**:

- Add artifact inspection to Windows ARM64 CI
- Evaluate BTI or MTE only when MSVC and Windows expose a supported, verifiable build control
- Evaluate x64 `/guard:ehcont` after testing all linked objects for compatible EH metadata

## Testing

CI builds the addon natively on `windows-11-arm` and runs the main test matrix there with Node.js
22, 24, and 26. It does not currently run a Windows 10 ARM64-emulation leg.

The Windows-specific Jest memory suite is skipped in Windows CI, and the standalone Windows
memory job currently runs on x64 only. Do not describe those as Windows ARM64 validation. The
ARM64 compiler/linker settings should be verified with MSBuild command lines and artifact tools
such as `dumpbin` when changing these flags.

## References

- [Microsoft ARM64 ABI](https://learn.microsoft.com/en-us/cpp/build/arm64-windows-abi-conventions)
- [ARM Security Features](https://developer.arm.com/documentation/102433/0100)
- [Windows ARM64 Security](https://learn.microsoft.com/en-us/windows/arm/overview)
- [Control Flow Guard on ARM64](https://learn.microsoft.com/en-us/windows/win32/secbp/control-flow-guard)

## Last Updated

2026-07-13 - Corrected ARM64 mitigation coverage and enabled signed returns
