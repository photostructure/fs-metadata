#!/bin/bash
# macOS AddressSanitizer test script

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== macOS AddressSanitizer Memory Test ===${NC}"

# Check if we're on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo -e "${YELLOW}Not on macOS. Skipping macOS-specific memory tests.${NC}"
    exit 0
fi

# Clean and rebuild with AddressSanitizer
echo -e "${YELLOW}Cleaning previous builds...${NC}"
npm run clean:native

# Tell binding.gyp this is a sanitizer build so it drops _FORTIFY_SOURCE.
# FORTIFY's libc interceptors collide with ASan's, producing false positives and
# false negatives (OpenSSF Compiler Options Hardening Guide).
export FS_METADATA_SANITIZE=1

# Configure build with ASan + UBSan flags.
#
# -fno-sanitize-recover=undefined is what makes UBSan GATE: by default UBSan is
# *recoverable* -- it prints "runtime error:" and continues, so the process can
# exit 0 with real undefined behavior found.
echo -e "${YELLOW}Building with AddressSanitizer + UndefinedBehaviorSanitizer...${NC}"
SAN_FLAGS="-fsanitize=address,undefined -fno-sanitize-recover=undefined"
export CFLAGS="$SAN_FLAGS -g -O1 -fno-omit-frame-pointer"
export CXXFLAGS="$SAN_FLAGS -g -O1 -fno-omit-frame-pointer"
export LDFLAGS="-fsanitize=address,undefined"
export UBSAN_OPTIONS="print_stacktrace=1:halt_on_error=1"

# Set ASan options. Initialization-order checking is unsupported on macOS.
# LeakSanitizer is unavailable on arm64 macOS; requesting detect_leaks there
# aborts ASan at startup with "detect_leaks is not supported on this platform".
# The Xcode `leaks` tool below covers native leak detection on Apple Silicon.
if [[ "$(uname -m)" == "arm64" ]]; then
    export ASAN_OPTIONS="print_stats=1"
else
    export ASAN_OPTIONS="detect_leaks=1:print_stats=1"
fi
export MallocScribble=1
export MallocGuardEdges=1

# Ask the selected Apple clang for its matching runtime. Guard the probe so an
# absent developer tool does not make `set -euo pipefail` bypass our diagnostic.
ASAN_LIB=""
if CLANG_BIN=$(xcrun --find clang 2>/dev/null); then
    CANDIDATE=$("$CLANG_BIN" -print-file-name=libclang_rt.asan_osx_dynamic.dylib)
    if [[ -f "$CANDIDATE" ]]; then
        ASAN_LIB="$CANDIDATE"
    fi
fi

if [[ -n "$ASAN_LIB" ]]; then
    export DYLD_INSERT_LIBRARIES="$ASAN_LIB"
    echo -e "${GREEN}Using ASan library: $ASAN_LIB${NC}"
else
    echo -e "${RED}Error: Could not find the macOS ASan runtime library.${NC}"
    exit 1
fi

# Build the native module
npm run node-gyp-rebuild

# Run tests with ASan and UBSan.
echo -e "${YELLOW}Running tests with AddressSanitizer and UBSan...${NC}"

# Invoke the setup-node binary directly. A `#!/usr/bin/env node` launcher takes
# a protected /usr/bin/env hop under SIP, which strips DYLD_INSERT_LIBRARIES.
NODE_BIN=$(command -v node)
ASAN_RUNTIME_NAME=$(basename "$ASAN_LIB")
if ! ASAN_PROBE_OUTPUT=$(DYLD_PRINT_LIBRARIES=1 ASAN_OPTIONS=detect_leaks=0 \
    "$NODE_BIN" --version 2>&1); then
    echo -e "${RED}ASan runtime preflight failed:${NC}"
    echo "$ASAN_PROBE_OUTPUT"
    exit 1
fi
if ! grep -Fq "$ASAN_RUNTIME_NAME" <<< "$ASAN_PROBE_OUTPUT"; then
    echo -e "${RED}ASan runtime was not loaded by the Node executable.${NC}"
    exit 1
fi

# Run the test and capture output
set +e
TEST_OUTPUT=$(TEST_ESM=0 "$NODE_BIN" node_modules/jest/bin/jest.js --no-coverage --runInBand 2>&1)
TEST_EXIT_CODE=$?
set -e

ASAN_OUTPUT_FILE=$(mktemp "${TMPDIR:-/tmp}/fs-metadata-macos-asan.XXXXXX")
trap 'rm -f "$ASAN_OUTPUT_FILE"' EXIT
printf '%s' "$TEST_OUTPUT" > "$ASAN_OUTPUT_FILE"
if [[ "${VERBOSE:-0}" == "1" ]]; then
    printf '%s\n' "$TEST_OUTPUT"
fi

# Analyze the captured output regardless of the exit code, mirroring the Linux
# sanitizers-test.sh path. A sanitizer report can be emitted with a zero exit
# code (e.g. LSAN_OPTIONS=exitcode=0), so the test exit code alone is not a
# sufficient gate. An interceptor startup failure is a failed sanitizer run,
# not an allowed skip.
set +e
env -u DYLD_INSERT_LIBRARIES -u ASAN_OPTIONS -u LSAN_OPTIONS -u UBSAN_OPTIONS \
    ./node_modules/.bin/tsx scripts/analyze-sanitizer-output.ts \
    "$ASAN_OUTPUT_FILE" "$TEST_EXIT_CODE"
ANALYSIS_EXIT_CODE=$?
set -e

if [[ $ANALYSIS_EXIT_CODE -ne 0 ]]; then
    echo -e "${RED}✗ Tests failed with AddressSanitizer${NC}"
    echo "$TEST_OUTPUT"
    # This is a real failure, exit with error
    exit 1
else
    echo -e "${GREEN}✓ Tests passed with AddressSanitizer and UBSan${NC}"
fi

# ASan replaces the malloc zones that Apple's `leaks` tool inspects. Rebuild
# without instrumentation before the leaks phase; merely unsetting the runtime
# while loading an ASan-linked addon would leave unresolved sanitizer symbols.
echo -e "${YELLOW}Rebuilding without sanitizers for the macOS leaks tool...${NC}"
unset DYLD_INSERT_LIBRARIES ASAN_OPTIONS UBSAN_OPTIONS
unset CFLAGS CXXFLAGS LDFLAGS FS_METADATA_SANITIZE
unset MallocScribble MallocGuardEdges
npm run clean:native
npm run node-gyp-rebuild

# Run memory leak check using leaks tool.
echo -e "${YELLOW}Running macOS leaks tool...${NC}"
if ! command -v leaks >/dev/null 2>&1; then
    echo -e "${RED}Error: the macOS leaks tool is required for native leak detection.${NC}"
    exit 1
fi

LEAKS_OUTPUT_FILE=$(mktemp "${TMPDIR:-/tmp}/fs-metadata-macos-leaks.XXXXXX")
trap 'rm -f "$ASAN_OUTPUT_FILE" "$LEAKS_OUTPUT_FILE"' EXIT
echo -e "${YELLOW}Executing memory leak test...${NC}"
if ! leaks --atExit -- "$NODE_BIN" --no-warnings -r tsx/cjs \
    src/test-utils/macos-leaks.ts > "$LEAKS_OUTPUT_FILE" 2>&1; then
    echo -e "${RED}✗ Memory leaks detected or leaks tool failed:${NC}"
    cat "$LEAKS_OUTPUT_FILE"
    exit 1
fi
if ! grep -q "MACOS_LEAKS_OK" "$LEAKS_OUTPUT_FILE"; then
    echo -e "${RED}✗ Leak workload did not complete.${NC}"
    cat "$LEAKS_OUTPUT_FILE"
    exit 1
fi
echo -e "${GREEN}✓ No memory leaks detected${NC}"
grep -E "(Process|leaks for|total leaked bytes)" "$LEAKS_OUTPUT_FILE" || true

echo -e "${GREEN}=== All macOS memory tests passed! ===${NC}"
