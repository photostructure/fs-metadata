#!/bin/bash
# ThreadSanitizer test runner for @photostructure/fs-metadata
#
# Why this exists: the addon is genuinely multithreaded. Napi::AsyncWorker runs
# Execute() on the libuv threadpool, and those workers touch process-global
# shared state:
#   - FSMeta::BlkidCache::mutex_      (src/linux/blkid_cache.cpp)
#   - FSMeta::Debug::debugPrefixMutex (src/common/debug_log.h)
#   - a per-napi_env std::atomic<bool> shutdown flag (src/common/shutdown.h)
#
# TSan verifies the lock discipline is actually correct: unguarded shared writes,
# lock-order inversions (potential deadlock), and races on the debug globals.
# Neither ASan nor Valgrind Memcheck finds data races.
#
# TSan is EXCLUSIVE with ASan -- it needs its own binary, hence its own script.

set -euo pipefail

if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "ThreadSanitizer tests are only supported on Linux"
    exit 0
fi

if ! command -v clang &> /dev/null; then
    echo "Error: clang is required for ThreadSanitizer tests"
    echo "Install with: sudo apt-get install clang"
    exit 1
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

OUTPUT_FILE="tsan-output.log"

echo -e "${YELLOW}Running ThreadSanitizer tests...${NC}"

rm -rf build/
rm -f "$OUTPUT_FILE"

# Sanitizer build: binding.gyp drops _FORTIFY_SOURCE when this is set.
export FS_METADATA_SANITIZE=1

export CC=clang
export CXX=clang++
export CFLAGS="-fsanitize=thread -fno-omit-frame-pointer -g -O1"
export CXXFLAGS="-fsanitize=thread -fno-omit-frame-pointer -g -O1"
export LDFLAGS="-fsanitize=thread"

# halt_on_error stops at the first race. history_size=7 keeps enough per-thread
# history to recover the second stack of a race (the default often truncates
# it). Keep matched suppressions visible so they can be audited and pruned.
export TSAN_OPTIONS="halt_on_error=1:history_size=7:print_suppressions=1:suppressions=$PWD/.tsan-suppressions.txt"

export NODE_OPTIONS="--max-old-space-size=8192"

# Node itself is not TSan-instrumented, so the runtime must be loaded before Node
# dlopen()s the addon -- same problem the ASan script solves.
#
# IMPORTANT: TSAN_LIB is deliberately NOT exported into LD_PRELOAD here. Running
# the *build* (npm/node-gyp, which fork many node processes) under the preloaded
# TSan runtime segfaults. Preload is applied only to the test run below.
echo "Detecting TSan runtime library..."
case "$(uname -m)" in
    x86_64|amd64)
        TSAN_ARCH="x86_64"
        TSAN_MULTIARCH="x86_64-linux-gnu"
        ;;
    aarch64|arm64)
        TSAN_ARCH="aarch64"
        TSAN_MULTIARCH="aarch64-linux-gnu"
        ;;
    *)
        echo -e "${RED}Error: unsupported TSan architecture: $(uname -m)${NC}"
        exit 1
        ;;
esac

TSAN_LIB=$(clang -print-file-name="libclang_rt.tsan-${TSAN_ARCH}.so" 2>/dev/null || echo "")
if [[ -z "$TSAN_LIB" || "$TSAN_LIB" == *"not found"* || ! -f "$TSAN_LIB" ]]; then
    for lib in "/usr/lib/${TSAN_MULTIARCH}"/libtsan.so.{2,0} /usr/lib64/libtsan.so.{2,0}; do
        if [[ -f "$lib" ]]; then
            TSAN_LIB="$lib"
            break
        fi
    done
fi

if [[ -z "$TSAN_LIB" || ! -f "$TSAN_LIB" ]]; then
    echo -e "${RED}Error: could not find the ThreadSanitizer runtime library${NC}"
    echo "A TSan build whose runtime never loads silently detects nothing, so"
    echo "this is a hard failure rather than a skip."
    exit 1
fi
echo -e "${BLUE}Using TSan library: $TSAN_LIB${NC}"

echo "Building with ThreadSanitizer..."
npm run clean:native
npm run node-gyp-rebuild

echo -e "${YELLOW}Running concurrency stress harness with ThreadSanitizer...${NC}"
set +e
# We deliberately run a dedicated stress harness rather than the Jest suite:
#
#  - TSan's LD_PRELOAD is inherited by CHILD PROCESSES. The debuglog suite spawns
#    child `node` processes and asserts on their stdout; TSan's startup re-exec
#    and diagnostics corrupt those assertions, failing ~8 tests for reasons that
#    have nothing to do with thread safety.
#  - Jest would multiply TSan's 5-15x slowdown across 600+ mostly single-threaded
#    tests, for no additional race coverage.
#
# src/test-utils/tsan-stress.ts drives the actually-threaded paths in-process:
# saturated libuv-threadpool AsyncWorkers, debug globals mutated while those
# workers run, and several worker_thread napi_envs sharing the process-global
# mutexes. It is loaded with `node -r tsx/cjs` (in-process, no child spawn),
# mirroring scripts/check-memory.ts. The V8 flags disable its uninstrumented
# compiler/GC background tasks (which otherwise produce false races); Node
# Worker threads and the libuv threadpool remain active and are exercised here.
LD_PRELOAD="$TSAN_LIB" \
    node --single-threaded --single-threaded-gc \
    --no-concurrent-recompilation --no-concurrent-sparkplug \
    --no-parallel-scavenge --no-concurrent-marking --no-concurrent-sweeping \
    --no-warnings -r tsx/cjs \
    src/test-utils/tsan-stress.ts 2>&1 | tee "$OUTPUT_FILE"
TEST_EXIT_CODE=${PIPESTATUS[0]}
set -e

# A harness that never reached its own success marker proves nothing, even with
# zero TSan reports -- treat that as a failure rather than silent green.
if ! grep -q "TSAN_STRESS_OK" "$OUTPUT_FILE"; then
    echo -e "${RED}✗ Stress harness did not complete (no TSAN_STRESS_OK marker)${NC}"
    TEST_EXIT_CODE=1
fi

echo -e "${BLUE}\nFull TSan output saved to: $OUTPUT_FILE${NC}"

# TSan reports data races under a *WARNING:* header and, without halt_on_error,
# can exit 0 while having found real races -- so the exit code alone is not a
# sufficient gate. analyze-sanitizer-output.ts matches the TSan headers too.
echo -e "\n${YELLOW}Analyzing TSan output...${NC}"
set +e
env -u TSAN_OPTIONS \
    ./node_modules/.bin/tsx scripts/analyze-sanitizer-output.ts \
    "$OUTPUT_FILE" "$TEST_EXIT_CODE"
EXIT_CODE=$?
set -e

if [[ "$EXIT_CODE" -eq 0 ]]; then
    echo -e "${GREEN}\n✓ ThreadSanitizer tests passed${NC}"
else
    echo -e "${RED}\n✗ Data race or thread-safety issue detected!${NC}"
    echo -e "${YELLOW}See $OUTPUT_FILE for full details${NC}"
fi

echo -e "\n${YELLOW}Cleaning build artifacts...${NC}"
npm run clean:native > /dev/null 2>&1
echo -e "${GREEN}✓ Build artifacts cleaned${NC}"

exit $EXIT_CODE
