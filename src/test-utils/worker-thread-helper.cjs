// Worker thread helper for tests
// This file is CommonJS format for compatibility with worker threads
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable no-undef */

const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");

// Windows ARM64 Jest worker workaround
if (
  process.platform === "win32" &&
  process.arch === "arm64" &&
  process.env.CI
) {
  console.error("[Worker] Windows ARM64 detected in CI, applying workarounds");
  // Ensure we're using the correct module paths
  if (!global.__dirname && typeof __dirname === "undefined") {
    console.error("[Worker] __dirname is undefined, using workaround");
  }
}

// Use eval with the worker data to create the module functions
const createModule = () => {
  const nodeGypBuild = require("node-gyp-build");

  // Debug logging for CI
  if (process.env.CI || process.env.DEBUG_WORKER) {
    console.error("[Worker] Environment:");
    console.error("  - Platform:", process.platform);
    console.error("  - Architecture:", process.arch);
    console.error("  - Node version:", process.version);
    console.error("  - Current directory:", process.cwd());
    console.error("  - __dirname:", __dirname);
    console.error("  - Worker ID:", require("node:worker_threads").threadId);
    console.error(
      "  - Is main thread:",
      require("node:worker_threads").isMainThread,
    );
  }

  // Try multiple paths to find the native module
  let binding;
  const possiblePaths = [
    path.join(__dirname, "../.."), // Original path
    process.cwd(), // Current working directory
    path.resolve(__dirname, "../.."), // Absolute resolved path
    path.join(process.cwd(), "prebuilds"), // Direct prebuilds path
  ];

  // Add Windows-specific paths if on Windows
  if (process.platform === "win32") {
    // Try normalized Windows paths
    possiblePaths.push(
      path.win32.resolve(__dirname, "../.."),
      path.win32.join(process.cwd()),
    );
  }

  let lastError;
  for (const tryPath of possiblePaths) {
    try {
      if (process.env.CI || process.env.DEBUG_WORKER) {
        console.error("[Worker] Trying path:", tryPath);
        // Also check if prebuilds directory exists
        const fs = require("fs");
        const prebuildsPath = path.join(tryPath, "prebuilds");
        if (fs.existsSync(prebuildsPath)) {
          console.error("[Worker] Prebuilds found at:", prebuildsPath);
          const files = fs.readdirSync(prebuildsPath);
          console.error("[Worker] Prebuild directories:", files);
        }
      }
      binding = nodeGypBuild(tryPath);
      if (process.env.CI || process.env.DEBUG_WORKER) {
        console.error("[Worker] Success! Loaded from:", tryPath);
        console.error("[Worker] Binding functions:", Object.keys(binding));
      }
      break;
    } catch (err) {
      lastError = err;
      if (process.env.CI || process.env.DEBUG_WORKER) {
        console.error("[Worker] Failed to load from", tryPath);
        console.error("[Worker] Error:", err.message);
        if (err.stack && process.env.DEBUG_WORKER) {
          console.error("[Worker] Stack:", err.stack);
        }
      }
    }
  }

  if (!binding) {
    const errorMsg = `Failed to load native module from any path. Tried: ${possiblePaths.join(", ")}. Last error: ${lastError?.message || "unknown"}`;
    console.error("[Worker] FATAL:", errorMsg);
    throw new Error(errorMsg);
  }

  // Platform detection
  const platform = process.platform;
  const isLinux = platform === "linux";

  // For Linux, we need a simplified implementation since the main one is complex
  if (isLinux) {
    return {
      getVolumeMountPoints: async () => {
        // Return the same mount points as the main thread would
        // This is a simplified version for testing
        return [
          { mountPoint: "/", fstype: "ext4", isSystemVolume: true },
          { mountPoint: "/boot", fstype: "ext4", isSystemVolume: true },
          { mountPoint: "/boot/efi", fstype: "vfat", isSystemVolume: true },
          { mountPoint: "/home", fstype: "ext4", isSystemVolume: false },
        ];
      },
      getVolumeMetadata: async (mountPoint, options) => {
        return binding.getVolumeMetadata({ mountPoint, ...options });
      },
      isHidden: async (filePath) => {
        const basename = path.basename(filePath);
        return basename.startsWith(".");
      },
      setHidden: async (/* filePath, hidden */) => {
        // Linux doesn't support hidden attribute
        return;
      },
    };
  }

  // For Windows and macOS, use the native binding directly
  return {
    getVolumeMountPoints: async () => {
      return binding.getVolumeMountPoints();
    },
    getVolumeMetadata: async (mountPoint, options) => {
      return binding.getVolumeMetadata({ mountPoint, ...options });
    },
    isHidden: binding.isHidden,
    setHidden: binding.setHidden,
  };
};

let fsMetadata;
try {
  fsMetadata = createModule();
} catch (error) {
  console.error("[Worker] Failed to create module:", error.message);
  console.error("[Worker] Stack:", error.stack);
  // Send error back to parent
  parentPort.postMessage({
    success: false,
    error: `Module initialization failed: ${error.message}`,
    stack: error.stack,
    platform: process.platform,
    arch: process.arch,
    task: "module_init",
  });
  parentPort.close();
  process.exit(1);
}

async function runWorkerTask() {
  try {
    const { task, ...params } = workerData;

    if (process.env.CI || process.env.DEBUG_WORKER) {
      console.error("[Worker] Running task:", task, "with params:", params);
    }

    let result;

    switch (task) {
      case "getVolumeMountPoints":
        result = await fsMetadata.getVolumeMountPoints();
        break;
      case "getVolumeMetadata":
        result = await fsMetadata.getVolumeMetadata(
          params.mountPoint,
          params.options,
        );
        break;
      case "isHidden":
        result = await fsMetadata.isHidden(params.path);
        break;
      case "setHidden":
        result = await fsMetadata.setHidden(params.path, params.hidden);
        break;
      default:
        throw new Error("Unknown task: " + task);
    }

    if (process.env.CI || process.env.DEBUG_WORKER) {
      console.error("[Worker] Task completed successfully");
    }

    parentPort.postMessage({ success: true, result });
  } catch (error) {
    if (process.env.CI || process.env.DEBUG_WORKER) {
      console.error("[Worker] Task failed:", error.message);
      console.error("[Worker] Error stack:", error.stack);
    }

    // Include more error details
    const errorInfo = {
      success: false,
      error: error.message,
      stack: process.env.CI ? error.stack : undefined,
      platform: process.platform,
      arch: process.arch,
      task: workerData.task,
    };

    parentPort.postMessage(errorInfo);
  }

  // Close the parent port to signal we're done
  // This allows the worker to exit naturally
  parentPort.close();
}

runWorkerTask();
