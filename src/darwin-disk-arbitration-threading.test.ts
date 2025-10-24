// macOS DiskArbitration threading test
// Verifies that DASession dispatch queue and RAII cleanup work correctly
// under concurrent load

import { getVolumeMetadata } from "./index";
import { isMacOS } from "./platform";

describe("DiskArbitration Threading (macOS)", () => {
  if (!isMacOS) {
    it.skip("macOS only", () => {});
    return;
  }

  it("should handle concurrent DiskArbitration queries without deadlock", async () => {
    // This test stresses the DASession dispatch queue and RAII cleanup
    // Each call to getVolumeMetadata() will:
    // 1. Create a DASession
    // 2. Schedule it on the dispatch queue
    // 3. Call DADiskCopyDescription
    // 4. Unschedule (via RAII) and release

    const iterations = 50;
    const concurrency = 10;

    // Get root volume to ensure we hit DiskArbitration code path
    const rootPath = "/";

    const results: boolean[] = [];

    // Run multiple batches concurrently
    for (let batch = 0; batch < iterations / concurrency; batch++) {
      const promises = Array.from({ length: concurrency }, async () => {
        try {
          const metadata = await getVolumeMetadata(rootPath);
          expect(metadata).toBeDefined();
          expect(metadata.mountPoint).toBe(rootPath);
          return true;
        } catch (error) {
          console.error(`Batch ${batch} failed:`, error);
          return false;
        }
      });

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);
    }

    // All operations should succeed
    const successCount = results.filter((r) => r).length;
    expect(successCount).toBe(iterations);
  }, 30000); // 30 second timeout

  it("should properly cleanup DASession on errors", async () => {
    // Test that RAII cleanup works even when operations fail
    const nonExistentPaths = [
      "/nonexistent/path/1",
      "/nonexistent/path/2",
      "/nonexistent/path/3",
      "/nonexistent/path/4",
      "/nonexistent/path/5",
    ];

    const promises = nonExistentPaths.map(async (path) => {
      try {
        await getVolumeMetadata(path);
        return { success: true, path };
      } catch (error) {
        // Expected to fail - verify we get proper error
        expect(String(error)).toMatch(/ENOENT|statvfs|realpath/i);
        return { success: false, path };
      }
    });

    const results = await Promise.all(promises);

    // All should fail (paths don't exist)
    const failureCount = results.filter((r) => !r.success).length;
    expect(failureCount).toBe(nonExistentPaths.length);

    // If RAII cleanup isn't working, this test might hang or crash
    // The fact that it completes successfully verifies cleanup
  });

  it("should handle rapid create/destroy of DASession", async () => {
    // Rapid-fire requests to stress RAII cleanup
    const rapidRequests = 100;
    const rootPath = "/";

    let successCount = 0;
    let errorCount = 0;

    const promises = Array.from({ length: rapidRequests }, async () => {
      try {
        await getVolumeMetadata(rootPath);
        successCount++;
      } catch {
        errorCount++;
      }
    });

    await Promise.all(promises);

    // Most should succeed (some might timeout, which is okay)
    expect(successCount).toBeGreaterThan(rapidRequests * 0.8);
    console.log(
      `Rapid test: ${successCount} succeeded, ${errorCount} failed out of ${rapidRequests}`,
    );
  }, 15000);
});
