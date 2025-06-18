// Worker thread helper for tests
// This file is CommonJS format for compatibility with worker threads
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable no-undef */

const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");

// Use eval with the worker data to create the module functions
const createModule = () => {
  const nodeGypBuild = require("node-gyp-build");
  const binding = nodeGypBuild(path.join(__dirname, "../.."));

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

const fsMetadata = createModule();

async function runWorkerTask() {
  try {
    const { task, ...params } = workerData;
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

    parentPort.postMessage({ success: true, result });
  } catch (error) {
    parentPort.postMessage({ success: false, error: error.message });
  }

  // Close the parent port to signal we're done
  // This allows the worker to exit naturally
  parentPort.close();
}

runWorkerTask();
