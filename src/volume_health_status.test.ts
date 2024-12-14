// src/volume_health_status.test.ts

import { TimeoutError } from "./async.js";
import {
  directoryStatus,
  VolumeHealthStatuses,
} from "./volume_health_status.js";

describe("directoryStatus", () => {
  it("should pass directory and timeout to test function", async () => {
    let capturedDir: string | undefined;
    let capturedTimeout: number | undefined;

    await directoryStatus("/test/path", 5000, (dir, timeout) => {
      capturedDir = dir;
      capturedTimeout = timeout;
      return Promise.resolve(true);
    });

    expect(capturedDir).toBe("/test/path");
    expect(capturedTimeout).toBe(5000);
  });

  it("should return healthy status when directory is accessible", async () => {
    const { status } = await directoryStatus("/test/dir", 1000, () =>
      Promise.resolve(true),
    );
    expect(status).toBe(VolumeHealthStatuses.healthy);
  });

  it("should return timeout status on TimeoutError", async () => {
    const { status } = await directoryStatus("/test/dir", 1000, () =>
      Promise.reject(new TimeoutError("Timeout")),
    );
    expect(status).toBe(VolumeHealthStatuses.timeout);
  });

  it("should return inaccessible status on EPERM error", async () => {
    const error = new Error("Permission denied");
    Object.assign(error, { code: "EPERM" });
    const { status } = await directoryStatus("/test/dir", 1000, () =>
      Promise.reject(error),
    );
    expect(status).toBe(VolumeHealthStatuses.inaccessible);
  });

  it("should return inaccessible status on EACCES error", async () => {
    const error = new Error("Access denied");
    Object.assign(error, { code: "EACCES" });
    const { status } = await directoryStatus("/test/dir", 1000, () =>
      Promise.reject(error),
    );
    expect(status).toBe(VolumeHealthStatuses.inaccessible);
  });

  it("should return unknown status on non-Error throws", async () => {
    const { status } = await directoryStatus("/test/dir", 1000, () =>
      Promise.reject("string error"),
    );
    expect(status).toBe(VolumeHealthStatuses.unknown);
  });

  it("should return unknown status on unrecognized error code", async () => {
    const error = new Error("Unknown error");
    Object.assign(error, { code: "UNKNOWN" });
    const { status } = await directoryStatus("/test/dir", 1000, () =>
      Promise.reject(error),
    );
    expect(status).toBe(VolumeHealthStatuses.unknown);
  });

  it("should handle zero timeout value", async () => {
    const { status } = await directoryStatus("/test/dir", 0, () =>
      Promise.resolve(true),
    );
    expect(status).toBe(VolumeHealthStatuses.healthy);
  });

  it("should handle empty directory path", async () => {
    const { status } = await directoryStatus("", 1000, () =>
      Promise.resolve(true),
    );
    expect(status).toBe(VolumeHealthStatuses.healthy);
  });

  it("should handle negative timeout value", async () => {
    const { status } = await directoryStatus("/test/dir", -1, () =>
      Promise.resolve(true),
    );
    expect(status).toBe(VolumeHealthStatuses.healthy);
  });

  it("should handle ENOENT error", async () => {
    const error = new Error("Directory not found");
    Object.assign(error, { code: "ENOENT" });
    const { status } = await directoryStatus("/test/dir", 1000, () =>
      Promise.reject(error),
    );
    expect(status).toBe(VolumeHealthStatuses.unknown);
  });

  it("should handle undefined error code", async () => {
    const error = new Error("Generic error");
    const { status } = await directoryStatus("/test/dir", 1000, () =>
      Promise.reject(error),
    );
    expect(status).toBe(VolumeHealthStatuses.unknown);
  });
});
