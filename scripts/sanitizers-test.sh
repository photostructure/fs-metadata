#!/bin/bash
# AddressSanitizer and LeakSanitizer test runner for @photostructure/fs-metadata
# Runs comprehensive memory safety checks on native code

set -euo pipefail

# Check if we're on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "AddressSanitizer tests are only supported on Linux"
    exit 0
fi

# Check for clang
if ! command -v clang &> /dev/null; then
    echo "Error: clang is required for AddressSanitizer tests"
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

echo -e "${YELLOW}Running AddressSanitizer and LeakSanitizer tests...${NC}"

# Clean previous builds if requested
if [[ "$CLEAN_BUILD" == "1" ]]; then
    echo "Cleaning previous builds..."
    rm -rf build/
fi
rm -f "$OUTPUT_FILE"

# Set up build environment
export CC=clang
export CXX=clang++
export CFLAGS="-fsanitize=address -fno-omit-frame-pointer -g -O1"
export CXXFLAGS="-fsanitize=address -fno-omit-frame-pointer -g -O1"
export LDFLAGS="-fsanitize=address"

# Comprehensive ASAN options combining both implementations
export ASAN_OPTIONS="detect_leaks=1:halt_on_error=0:print_stats=1:check_initialization_order=1:strict_init_order=1:print_module_map=1"
export LSAN_OPTIONS="suppressions=$(pwd)/.lsan-suppressions.txt:print_suppressions=0"

# Increase Node.js heap size for ASan overhead
export NODE_OPTIONS="--max-old-space-size=8192"

# Find and set ASan runtime library
echo "Detecting ASan runtime library..."
ASAN_LIB=$(clang -print-file-name=libclang_rt.asan-x86_64.so 2>/dev/null || echo "")

if [[ -n "$ASAN_LIB" && "$ASAN_LIB" != *"not found"* && -f "$ASAN_LIB" ]]; then
    export LD_PRELOAD="$ASAN_LIB"
    echo -e "${BLUE}Using ASan library: $ASAN_LIB${NC}"
else
    # Try common paths as fallback
    for lib in /usr/lib/x86_64-linux-gnu/libasan.so.{8,6} /usr/lib64/libasan.so.{8,6}; do
        if [[ -f "$lib" ]]; then
            export LD_PRELOAD="$lib"
            echo -e "${BLUE}Using ASan library: $lib${NC}"
            break
        fi
    done
fi

if [[ -z "${LD_PRELOAD:-}" ]]; then
    echo -e "${YELLOW}Warning: Could not find ASan runtime library${NC}"
fi

# Build the native module
echo "Building with AddressSanitizer..."
npm run setup:native
npm run node-gyp-rebuild

# Run tests and capture output
echo -e "${YELLOW}Running tests with AddressSanitizer...${NC}"
set +e  # Don't exit on test failure
npm test -- --no-coverage 2>&1 | tee "$OUTPUT_FILE"
TEST_EXIT_CODE=${PIPESTATUS[0]}
set -e

echo -e "${BLUE}\nFull ASAN output saved to: $OUTPUT_FILE${NC}"

# Analyze output for errors specific to our code
echo -e "\n${YELLOW}Analyzing ASAN output...${NC}"

# Count different types of issues
OUR_ERRORS=0
OUR_LEAKS=0
INTERNAL_LEAKS=0

# Check for ASAN errors in our code (not V8/Node internals)
if grep -E "(ERROR: AddressSanitizer|ERROR: LeakSanitizer)" "$OUTPUT_FILE" | grep -E "(fs_metadata\.node|/src/)" > /dev/null; then
    OUR_ERRORS=1
fi

# Check for direct/indirect leaks in our code with context
while IFS= read -r line_num; do
    # Get 5 lines before and 10 lines after for context
    start=$((line_num - 5))
    end=$((line_num + 10))
    if sed -n "${start},${end}p" "$OUTPUT_FILE" | grep -E "(fs_metadata\.node|/src/|photostructure)" > /dev/null; then
        OUR_LEAKS=1
        break
    fi
done < <(grep -n "Direct leak\|Indirect leak" "$OUTPUT_FILE" | cut -d: -f1)

# Count V8/Node internal leaks for information
INTERNAL_LEAKS=$(grep -c "leak.*\/usr\/bin\/node" "$OUTPUT_FILE" 2>/dev/null || echo "0")
INTERNAL_LEAKS="${INTERNAL_LEAKS//[[:space:]]/}"  # Remove any whitespace

# Report results
EXIT_CODE=0

if [[ "$OUR_ERRORS" -eq 1 ]]; then
    echo -e "${RED}\n✗ AddressSanitizer found errors in fs-metadata code:${NC}"
    grep -E "(ERROR: AddressSanitizer|ERROR: LeakSanitizer)" "$OUTPUT_FILE" | grep -E "(fs_metadata\.node|/src/)" | head -20
    EXIT_CODE=1
fi

if [[ "$OUR_LEAKS" -eq 1 ]]; then
    echo -e "${RED}\n✗ LeakSanitizer found memory leaks in fs-metadata code:${NC}"
    # Show leak summary
    grep -A 5 "SUMMARY: AddressSanitizer" "$OUTPUT_FILE" || true
    EXIT_CODE=1
fi

if [[ "$EXIT_CODE" -eq 0 ]]; then
    echo -e "${GREEN}\n✓ AddressSanitizer and LeakSanitizer tests passed (no issues in fs-metadata code)${NC}"
    if [[ "$INTERNAL_LEAKS" -gt 0 ]]; then
        echo -e "${YELLOW}   Note: $INTERNAL_LEAKS V8/Node.js internal leaks detected (suppressed)${NC}"
    fi
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