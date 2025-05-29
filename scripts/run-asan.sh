#!/bin/bash
# AddressSanitizer test runner for @photostructure/fs-metadata

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
NC='\033[0m' # No Color

echo -e "${YELLOW}Running AddressSanitizer tests...${NC}"

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf build/
rm -f asan-output.log

# Set up ASan environment
export CC=clang
export CXX=clang++
export CFLAGS="-fsanitize=address -fno-omit-frame-pointer -g -O1"
export CXXFLAGS="-fsanitize=address -fno-omit-frame-pointer -g -O1"
export LDFLAGS="-fsanitize=address"

# Find ASan runtime library
ASAN_LIB=$(clang -print-file-name=libclang_rt.asan-x86_64.so 2>/dev/null || true)
if [[ -f "$ASAN_LIB" ]]; then
    export LD_PRELOAD="$ASAN_LIB"
    echo "Using ASan library: $ASAN_LIB"
fi

# Set ASan options
export ASAN_OPTIONS="detect_leaks=1:check_initialization_order=1:strict_init_order=1:print_stats=1:print_module_map=1"
export LSAN_OPTIONS="suppressions=$(pwd)/.lsan-suppressions.txt:print_suppressions=0"

# Set Node.js options to increase memory for ASan overhead
export NODE_OPTIONS="--max-old-space-size=8192"

# Build the native module
echo "Building with AddressSanitizer..."
npm run node-gyp-rebuild

# Run tests and capture output
echo "Running tests..."
npm run test -- --no-coverage 2>&1 | tee asan-output.log

# Analyze results
echo -e "\n${YELLOW}Analyzing AddressSanitizer output...${NC}"

# Check for errors in our code (excluding V8/Node internals)
if grep -E "ERROR: AddressSanitizer" asan-output.log | grep -v "/usr/bin/node" > /dev/null 2>&1; then
    echo -e "${RED}AddressSanitizer detected errors in fs-metadata code!${NC}"
    grep -A5 -B5 "ERROR: AddressSanitizer" asan-output.log | grep -v "/usr/bin/node" || true
    exit 1
fi

# Check for leaks in our code
if grep -E "Direct leak.*photostructure|Indirect leak.*photostructure" asan-output.log > /dev/null 2>&1; then
    echo -e "${RED}Memory leaks detected in fs-metadata code!${NC}"
    grep -A5 -B5 "leak.*photostructure" asan-output.log || true
    exit 1
fi

# Check for any leaks from our native module
if grep -E "leak.*build/Release/fs_metadata.node" asan-output.log > /dev/null 2>&1; then
    echo -e "${RED}Memory leaks detected in native module!${NC}"
    grep -A5 -B5 "leak.*fs_metadata.node" asan-output.log || true
    exit 1
fi

# Report on V8/Node.js internal leaks (informational only)
INTERNAL_LEAKS=$(grep -c "leak.*node" asan-output.log 2>/dev/null || echo "0")
if [[ "$INTERNAL_LEAKS" -gt 0 ]]; then
    echo -e "${YELLOW}Note: Found $INTERNAL_LEAKS V8/Node.js internal leaks (suppressed)${NC}"
fi

echo -e "${GREEN}✓ AddressSanitizer tests passed! No memory errors in fs-metadata code.${NC}"
echo "Full output saved to: asan-output.log"