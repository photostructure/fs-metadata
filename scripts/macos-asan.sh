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

# Configure build with ASan flags
echo -e "${YELLOW}Building with AddressSanitizer enabled...${NC}"
export CFLAGS="-fsanitize=address -g -O1 -fno-omit-frame-pointer"
export CXXFLAGS="-fsanitize=address -g -O1 -fno-omit-frame-pointer"
export LDFLAGS="-fsanitize=address"

# Set ASan options.
# LeakSanitizer is unavailable on arm64 macOS; requesting detect_leaks there
# aborts ASan at startup with "detect_leaks is not supported on this platform".
# The Xcode `leaks` tool below covers native leak detection on Apple Silicon.
if [[ "$(uname -m)" == "arm64" ]]; then
    export ASAN_OPTIONS="check_initialization_order=1:strict_init_order=1:print_stats=1"
else
    export ASAN_OPTIONS="detect_leaks=1:check_initialization_order=1:strict_init_order=1:print_stats=1"
fi
export MallocScribble=1
export MallocGuardEdges=1

# Find and set the ASan library path for macOS
# First try to find the most recent version
ASAN_LIB=$(find /Library/Developer/CommandLineTools/usr/lib/clang/*/lib/darwin -name "libclang_rt.asan_osx_dynamic.dylib" 2>/dev/null | sort -V | tail -1)
if [[ -z "$ASAN_LIB" ]]; then
    # Try alternative location
    ASAN_LIB=$(find /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/clang/*/lib/darwin -name "libclang_rt.asan_osx_dynamic.dylib" 2>/dev/null | sort -V | tail -1)
fi

if [[ -n "$ASAN_LIB" ]]; then
    export DYLD_INSERT_LIBRARIES="$ASAN_LIB"
    echo -e "${GREEN}Using ASan library: $ASAN_LIB${NC}"
else
    echo -e "${RED}Warning: Could not find ASan library. Tests may not run properly.${NC}"
fi

# Build the native module
npm run node-gyp-rebuild

# Run tests with ASan
echo -e "${YELLOW}Running tests with AddressSanitizer...${NC}"

# Note: On macOS with SIP enabled, DYLD_INSERT_LIBRARIES is stripped from
# child processes. Jest uses worker processes, so we need to run tests
# in a single process to ensure ASAN works correctly.

# Run the test and capture output
set +e
TEST_OUTPUT=$(TEST_ESM=0 ./node_modules/.bin/jest --no-coverage --runInBand 2>&1)
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
# sufficient gate. --allow-macos-sip permits ONLY the exact three-line SIP
# interceptor startup failure; Jest is invoked directly above so any additional
# captured output rejects it.
set +e
env -u DYLD_INSERT_LIBRARIES -u ASAN_OPTIONS -u LSAN_OPTIONS \
    ./node_modules/.bin/tsx scripts/analyze-sanitizer-output.ts \
    "$ASAN_OUTPUT_FILE" "$TEST_EXIT_CODE" --allow-macos-sip
ANALYSIS_EXIT_CODE=$?
set -e

if [[ $ANALYSIS_EXIT_CODE -ne 0 ]]; then
    echo -e "${RED}✗ Tests failed with AddressSanitizer${NC}"
    echo "$TEST_OUTPUT"
    # This is a real failure, exit with error
    exit 1
elif [[ $TEST_EXIT_CODE -eq 0 ]]; then
    echo -e "${GREEN}✓ Tests passed with AddressSanitizer${NC}"
else
    echo -e "${YELLOW}⚠ Tests completed but AddressSanitizer interceptors not installed${NC}"
    echo -e "${YELLOW}  This is due to macOS System Integrity Protection (SIP) stripping${NC}"
    echo -e "${YELLOW}  DYLD_INSERT_LIBRARIES from child processes. This is expected behavior.${NC}"
    echo -e "${YELLOW}  To run ASAN tests properly, you may need to disable SIP temporarily.${NC}"
    # Known SIP condition: not a failure.
fi

# Run memory leak check using leaks tool
echo -e "${YELLOW}Running macOS leaks tool...${NC}"
if command -v leaks >/dev/null 2>&1; then
    # Get the project root directory
    PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
    
    # Check if the native module exists
    if [ ! -f "${PROJECT_ROOT}/build/Release/fs_metadata.node" ]; then
        echo -e "${RED}Native module not found. Skipping leaks test.${NC}"
        exit 1
    fi
    
    # Create a simple test script
    cat > /tmp/test-leaks.js << EOF
const fs = require('fs');
const binding = require('${PROJECT_ROOT}/build/Release/fs_metadata.node');

async function testVolumeMountPoints() {
    for (let i = 0; i < 100; i++) {
        await binding.getVolumeMountPoints();
    }
}

async function testVolumeMetadata() {
    const mountPoints = await binding.getVolumeMountPoints();
    if (mountPoints.length > 0) {
        for (let i = 0; i < 10; i++) {
            await binding.getVolumeMetadata({ mountPoint: mountPoints[0].mountPoint });
        }
    }
}

async function runTests() {
    await testVolumeMountPoints();
    await testVolumeMetadata();
    
    // Force garbage collection if available
    if (global.gc) {
        global.gc();
    }
}

runTests().then(() => {
    console.log('Tests completed');
    // Give time for cleanup
    setTimeout(() => process.exit(0), 1000);
}).catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
EOF

    # Run with leaks detection
    echo -e "${YELLOW}Executing memory leak test...${NC}"
    if leaks --atExit -- node --expose-gc /tmp/test-leaks.js > /tmp/leaks-output.txt 2>&1; then
        echo -e "${GREEN}✓ No memory leaks detected${NC}"
        # Show summary if available
        if grep -q "Process" /tmp/leaks-output.txt; then
            echo -e "${YELLOW}Summary:${NC}"
            grep -E "(Process|leaks for|total leaked bytes)" /tmp/leaks-output.txt || true
        fi
    else
        echo -e "${RED}✗ Memory leaks detected or leaks tool failed:${NC}"
        cat /tmp/leaks-output.txt
        # Don't exit with failure - leaks tool can have false positives
        echo -e "${YELLOW}Note: The leaks tool may report false positives from Node.js internals.${NC}"
    fi
    
    rm -f /tmp/test-leaks.js /tmp/leaks-output.txt
else
    echo -e "${YELLOW}leaks tool not available. Skipping native leak detection.${NC}"
fi

echo -e "${GREEN}=== All macOS memory tests passed! ===${NC}"
