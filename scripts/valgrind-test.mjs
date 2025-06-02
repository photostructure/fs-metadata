#!/usr/bin/env node

/**
 * Valgrind test runner for @photostructure/fs-metadata
 *
 * This script exercises the native module's core functionality to detect
 * memory leaks. It's designed to be run under valgrind via npm run test:valgrind
 *
 * The test performs multiple iterations of each operation to help detect
 * memory leaks that might only appear after repeated use.
 */

import {
  getAllVolumeMetadata,
  getVolumeMetadata,
  getVolumeMountPoints,
  isHidden,
} from "../dist/index.mjs";

async function runTests() {
  console.log("Starting valgrind memory leak tests...");

  // Test 1: Exercise getVolumeMountPoints multiple times
  console.log("Test 1: getVolumeMountPoints");
  for (let i = 0; i < 10; i++) {
    await getVolumeMountPoints();
    if (i % 5 === 0) console.log(`  Iteration ${i + 1}/10`);
  }

  // Test 2: Exercise getVolumeMetadata with valid and invalid paths
  console.log("Test 2: getVolumeMetadata");
  for (let i = 0; i < 10; i++) {
    try {
      await getVolumeMetadata("/");
    } catch {
      // Expected for some platforms
    }

    try {
      await getVolumeMetadata("/nonexistent-path-" + i);
    } catch {
      // Expected - testing error paths
    }

    if (i % 5 === 0) console.log(`  Iteration ${i + 1}/10`);
  }

  // Test 3: Exercise getAllVolumeMetadata
  console.log("Test 3: getAllVolumeMetadata");
  try {
    await getAllVolumeMetadata();
    console.log("  Completed successfully");
  } catch (e) {
    console.log("  Completed with expected error:", e.message);
  }

  // Test 4: Exercise hidden file operations
  console.log("Test 4: isHidden");
  const testPaths = ["/tmp", "/var", "/nonexistent"];
  for (let i = 0; i < 10; i++) {
    for (const path of testPaths) {
      try {
        await isHidden(path);
      } catch {
        // Expected for some paths
      }
    }
    if (i % 5 === 0) console.log(`  Iteration ${i + 1}/10`);
  }

  console.log("Valgrind tests completed");
}

// Run tests and exit
runTests()
  .then(() => {
    console.log("All tests completed successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test error:", err);
    process.exit(1);
  });
