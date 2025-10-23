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

## Flags Intentionally Omitted for ARM64

### `/Qspectre` - Spectre Mitigation ❌ NOT AVAILABLE

**Why omitted**: This flag is x64/x86-specific and not available for ARM64

- **Spectre vulnerability**: CPU speculative execution side-channel attack
- **x64 mitigation**: Compiler inserts speculation barriers
- **ARM64 status**: ARM processors have different speculative execution behavior
- **Alternative**: ARM64 has hardware-level mitigations built into the CPU architecture
- **Reference**: [Microsoft ARM64 Security](https://learn.microsoft.com/en-us/windows-hardware/drivers/kernel/arm64-exception-handling)

### `/CETCOMPAT` - Control-flow Enforcement Technology ❌ NOT AVAILABLE

**Why omitted**: Intel CET is x64-specific and not available for ARM64

- **Intel CET**: Hardware-based control-flow integrity (shadow stack)
- **x64 status**: Available on recent Intel CPUs (11th gen+)
- **ARM64 alternative**: ARM has different hardware security features:
  - **PAC (Pointer Authentication Codes)**: Cryptographic signatures on pointers
  - **BTI (Branch Target Identification)**: Forward-edge control flow integrity
- **Future**: When compiler support for ARM64 shadow stack stabilizes, we may add it
- **Reference**: [ARM Pointer Authentication](https://learn.microsoft.com/en-us/cpp/build/arm64-windows-abi-conventions?view=msvc-170#pointer-authentication-on-arm64)

## ARM64-Specific Security Features

While ARM64 doesn't support `/Qspectre` or `/CETCOMPAT`, it has equivalent or superior hardware-level security features:

### 1. Pointer Authentication (PAC)

- Cryptographically signs pointers to prevent corruption
- Protects return addresses and function pointers
- Hardware-accelerated, minimal performance overhead
- **Status**: Supported in hardware, compiler support evolving

### 2. Branch Target Identification (BTI)

- Ensures indirect branches land on valid targets
- Prevents code-reuse attacks (ROP/JOP)
- Hardware-enforced control flow integrity
- **Status**: Supported in hardware, compiler support evolving

### 3. Memory Tagging Extension (MTE)

- Hardware-based memory safety
- Detects use-after-free and buffer overflows
- Probabilistic detection with ~0-15% overhead
- **Status**: ARMv8.5-A+, not yet in consumer Windows devices

## Comparison: x64 vs ARM64 Security

| Feature            | x64                             | ARM64                   | Notes                         |
| ------------------ | ------------------------------- | ----------------------- | ----------------------------- |
| Control Flow Guard | ✅ `/guard:cf`                  | ✅ `/guard:cf`          | Same implementation           |
| ASLR               | ✅ `/DYNAMICBASE`               | ✅ `/DYNAMICBASE`       | Same implementation           |
| Spectre Mitigation | ✅ `/Qspectre`                  | ⚠️ Hardware mitigations | Different approaches          |
| Shadow Stack       | ✅ `/CETCOMPAT` (Intel CET)     | ⚠️ PAC (different tech) | Both protect return addresses |
| Branch Protection  | ✅ CET Indirect Branch Tracking | ✅ BTI                  | Similar purpose               |
| Memory Safety      | ⚠️ Software-based               | ✅ MTE (future)         | ARM has hardware advantage    |

## Build Configuration

### Current ARM64 Flags (binding.gyp)

```json
{
  "target_arch=='arm64'": {
    "defines": ["_M_ARM64", "_WIN64"],
    "msvs_settings": {
      "VCCLCompilerTool": {
        "AdditionalOptions": ["/guard:cf", "/ZH:SHA_256", "/sdl"],
        "ExceptionHandling": 1,
        "RuntimeTypeInfo": "true"
      },
      "VCLinkerTool": {
        "AdditionalOptions": ["/guard:cf", "/DYNAMICBASE"]
      }
    }
  }
}
```

### Security Posture

✅ **Current**: ARM64 builds have equivalent or better security than x64

- All applicable mitigations are enabled
- ARM64 hardware features provide additional protection
- No security regression compared to x64

⏳ **Future Improvements**:

- Monitor compiler support for ARM64 shadow stack
- Evaluate PAC/BTI enablement when stable
- Consider MTE when available in consumer devices

## Testing

ARM64 builds are tested on:

- Windows 11 ARM64 (native)
- Windows 10 ARM64 (emulation on x64)

Security features are validated through:

- Static analysis during compilation
- Runtime testing on ARM64 devices
- Memory safety tests (windows-memory-check.test.ts)

## References

- [Microsoft ARM64 ABI](https://learn.microsoft.com/en-us/cpp/build/arm64-windows-abi-conventions)
- [ARM Security Features](https://developer.arm.com/documentation/102433/0100)
- [Windows ARM64 Security](https://learn.microsoft.com/en-us/windows/arm/overview)
- [Control Flow Guard on ARM64](https://learn.microsoft.com/en-us/windows/win32/secbp/control-flow-guard)

## Last Updated

2025-10-23 - Initial documentation of ARM64 security configuration
