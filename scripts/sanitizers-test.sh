#!/bin/bash
# AddressSanitizer, LeakSanitizer, and UndefinedBehaviorSanitizer test runner
# for @photostructure/fs-metadata
# Runs comprehensive memory safety checks on native code

set -euo pipefail

# Check if we're on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "Native sanitizer tests are only supported on Linux"
    exit 0
fi

# Check for clang
if ! command -v clang &> /dev/null; then
    echo "Error: clang is required for native sanitizer tests"
    echo "Install with: sudo apt-get install clang"
    exit 1
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CLEAN_BUILD=${CLEAN_BUILD:-1}
VERBOSE=${VERBOSE:-0}
OUTPUT_FILE="asan-output.log"

echo -e "${YELLOW}Running AddressSanitizer, LeakSanitizer, and UBSan tests...${NC}"

# Clean previous builds if requested
if [[ "$CLEAN_BUILD" == "1" ]]; then
    echo "Cleaning previous builds..."
    rm -rf build/
fi
rm -f "$OUTPUT_FILE"

# Tell binding.gyp this is a sanitizer build so it drops _FORTIFY_SOURCE.
# FORTIFY's libc interceptors collide with ASan's, producing false positives and
# false negatives (OpenSSF Compiler Options Hardening Guide). Overriding via env
# CFLAGS ordering would be fragile; the gyp variable is explicit.
export FS_METADATA_SANITIZE=1

# Set up build environment.
#
# ASan + UBSan share one binary (legal combination; LSan ships inside ASan).
#
# -fno-sanitize-recover=undefined is what makes UBSan GATE: by default UBSan is
# *recoverable* -- it prints "runtime error:" and keeps going, so the process can
# exit 0 with real undefined behavior found.
#
# Note: UBSan's `vptr` check is inert here. It requires RTTI, and Node's
# common.gypi compiles addons with -fno-rtti; clang silently omits vptr from the
# `undefined` group in that case (only an *explicit* -fsanitize=vptr errors).
SAN_FLAGS="-fsanitize=address,undefined -fno-sanitize-recover=undefined"
export CC=clang
export CXX=clang++
export CFLAGS="$SAN_FLAGS -fno-omit-frame-pointer -g -O1"
export CXXFLAGS="$SAN_FLAGS -fno-omit-frame-pointer -g -O1"
export LDFLAGS="-fsanitize=address,undefined"

# The suppression file contains only exact, empirically observed external leaf
# functions. Broad Node/libuv/pthread frames also occur in first-party addon
# allocation stacks and would hide real leaks. Keep counts visible in output.
export ASAN_OPTIONS="detect_leaks=1:check_initialization_order=1:strict_init_order=1"
if [[ "$VERBOSE" -eq 1 ]]; then
    ASAN_OPTIONS+=":print_stats=1"
fi
export LSAN_OPTIONS="suppressions=$PWD/.lsan-suppressions.txt:print_suppressions=1"
# print_stacktrace is off by default and is almost always wanted; halt_on_error
# complements -fno-sanitize-recover so a UB finding stops the run.
export UBSAN_OPTIONS="print_stacktrace=1:halt_on_error=1"

# Increase Node.js heap size for ASan overhead
export NODE_OPTIONS="--max-old-space-size=8192"

# Find and set ASan runtime library
echo "Detecting ASan runtime library..."
case "$(uname -m)" in
    x86_64|amd64)
        ASAN_ARCH="x86_64"
        ASAN_MULTIARCH="x86_64-linux-gnu"
        ;;
    aarch64|arm64)
        ASAN_ARCH="aarch64"
        ASAN_MULTIARCH="aarch64-linux-gnu"
        ;;
    *)
        echo -e "${RED}Error: unsupported ASan architecture: $(uname -m)${NC}"
        exit 1
        ;;
esac

ASAN_LIB=$(clang -print-file-name="libclang_rt.asan-${ASAN_ARCH}.so" 2>/dev/null || echo "")

if [[ -n "$ASAN_LIB" && "$ASAN_LIB" != *"not found"* && -f "$ASAN_LIB" ]]; then
    echo -e "${BLUE}Using ASan library: $ASAN_LIB${NC}"
else
    # Try common paths as fallback
    for lib in "/usr/lib/${ASAN_MULTIARCH}"/libasan.so.{8,6} /usr/lib64/libasan.so.{8,6}; do
        if [[ -f "$lib" ]]; then
            ASAN_LIB="$lib"
            echo -e "${BLUE}Using ASan library: $lib${NC}"
            break
        fi
    done
fi

if [[ -z "$ASAN_LIB" || ! -f "$ASAN_LIB" ]]; then
    echo -e "${RED}Error: could not find the AddressSanitizer runtime library${NC}"
    echo "A sanitizer build whose runtime never loads provides no runtime coverage."
    exit 1
fi

# Preload only the test process. Preloading npm/node-gyp during the build adds
# unrelated Node runtime leak reports and can abort before the addon is built.
unset LD_PRELOAD

# Build the native module
echo "Building with AddressSanitizer and UBSan..."
npm run clean:native
npm run node-gyp-rebuild

# Run tests and capture output
echo -e "${YELLOW}Running tests with AddressSanitizer and UBSan...${NC}"
set +e  # Don't exit on test failure
# debuglog.test.ts exercises TypeScript-only logging through `npx tsx` child
# processes; it never loads the addon. Preloading LSan into those stock-Node
# helpers reports megabytes of V8 shutdown allocations and can overflow the
# test's spawnSync buffer, without adding native-code coverage. The normal Jest
# suite still runs that file.
LD_PRELOAD="$ASAN_LIB" TEST_ESM=0 \
    node node_modules/jest/bin/jest.js --no-coverage --runInBand \
    "--testPathIgnorePatterns=debuglog\\.test\\.ts$" \
    2>&1 | tee "$OUTPUT_FILE"
TEST_EXIT_CODE=${PIPESTATUS[0]}
set -e

echo -e "${BLUE}\nFull sanitizer output saved to: $OUTPUT_FILE${NC}"

# Analyze output for errors specific to our code
echo -e "\n${YELLOW}Analyzing sanitizer output...${NC}"

# Analyze the complete report and propagate the test pipeline status. Run the
# analyzer without sanitizer preloading so it cannot add its own diagnostics to
# the result being classified.
set +e
env -u LD_PRELOAD -u ASAN_OPTIONS -u LSAN_OPTIONS -u UBSAN_OPTIONS \
    ./node_modules/.bin/tsx scripts/analyze-sanitizer-output.ts \
    "$OUTPUT_FILE" "$TEST_EXIT_CODE"
EXIT_CODE=$?
set -e

if [[ "$EXIT_CODE" -eq 0 ]]; then
    echo -e "${GREEN}\n✓ AddressSanitizer, LeakSanitizer, and UBSan tests passed${NC}"
else
    echo -e "${RED}\n✗ Memory safety issues detected!${NC}"
    echo -e "${YELLOW}See $OUTPUT_FILE for full details${NC}"
fi

# Show ASAN statistics if verbose
if [[ "$VERBOSE" -eq 1 ]] && grep -q "Stats:" "$OUTPUT_FILE"; then
    echo -e "\n${BLUE}ASAN Statistics:${NC}"
    grep -A 20 "Stats:" "$OUTPUT_FILE" | head -20
fi

# Clean build artifacts to ensure no ASAN-compiled code remains
echo -e "\n${YELLOW}Cleaning build artifacts...${NC}"
npm run clean:native > /dev/null 2>&1
echo -e "${GREEN}✓ Build artifacts cleaned${NC}"

exit $EXIT_CODE
