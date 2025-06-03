#!/bin/bash

# Valgrind memory leak detection script for CI/CD
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if valgrind is available
if ! command -v valgrind &> /dev/null; then
    echo -e "${YELLOW}Warning: valgrind not found. Skipping memory leak tests.${NC}"
    exit 0
fi

# Only run on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo -e "${YELLOW}Valgrind tests only run on Linux. Skipping.${NC}"
    exit 0
fi

echo -e "${GREEN}Running valgrind memory leak detection...${NC}"

# Path to the dedicated valgrind test script
VALGRIND_TEST="$SCRIPT_DIR/valgrind-test.mjs"

# Ensure the test script exists
if [ ! -f "$VALGRIND_TEST" ]; then
    echo -e "${RED}Error: Valgrind test script not found at $VALGRIND_TEST${NC}"
    exit 1
fi

# Check if dist directory exists (indicates build completed)
if [ ! -d "$ROOT_DIR/dist" ]; then
    echo -e "${RED}Error: dist/ directory not found. Run 'npm run build:dist' first.${NC}"
    exit 1
fi

# Pre-flight check: run the test script without valgrind first
echo "Running pre-flight check..."
if ! node "$VALGRIND_TEST" > /dev/null 2>&1; then
    echo -e "${RED}Error: Test script failed to run. Running again to show error:${NC}"
    node "$VALGRIND_TEST"
    exit 1
fi
echo -e "${GREEN}✓ Pre-flight check passed${NC}"

# Use the committed suppressions file
SUPP_FILE="$ROOT_DIR/.valgrind.supp"

# Ensure suppressions file exists
if [ ! -f "$SUPP_FILE" ]; then
    echo -e "${RED}Error: Valgrind suppressions file not found at $SUPP_FILE${NC}"
    exit 1
fi

# Run valgrind with appropriate options
VALGRIND_OPTS="--leak-check=full --show-leak-kinds=definite,indirect,possible --track-origins=yes --suppressions=$SUPP_FILE"

echo "Running valgrind tests..."
if valgrind $VALGRIND_OPTS node "$VALGRIND_TEST" 2>&1 | tee "$ROOT_DIR/valgrind.log"; then
    # Check the log for actual leaks
    if grep -q "definitely lost: 0 bytes in 0 blocks" "$ROOT_DIR/valgrind.log" && \
       grep -q "indirectly lost: 0 bytes in 0 blocks" "$ROOT_DIR/valgrind.log"; then
        echo -e "${GREEN}✓ No memory leaks detected${NC}"
        RESULT=0
    else
        echo -e "${RED}✗ Memory leaks detected${NC}"
        grep -A 5 "LEAK SUMMARY" "$ROOT_DIR/valgrind.log"
        RESULT=1
    fi
else
    echo -e "${RED}✗ Valgrind error${NC}"
    RESULT=1
fi

# Cleanup log file only (keep the committed suppression file)
rm -f "$ROOT_DIR/valgrind.log"

exit $RESULT