import { isMountPoint } from "./mount_point";

describe("isMountPoint", () => {
  it("should return true for valid mount point objects", () => {
    expect(isMountPoint({ mountPoint: "/" })).toBe(true);
    expect(isMountPoint({ mountPoint: "/home" })).toBe(true);
    expect(isMountPoint({ mountPoint: "C:\\\\" })).toBe(true);
    expect(isMountPoint({ mountPoint: "/mnt/data", extra: "field" })).toBe(
      true,
    );
  });

  it("should return false for invalid mount point objects", () => {
    expect(isMountPoint(null)).toBe(false);
    expect(isMountPoint(undefined)).toBe(false);
    expect(isMountPoint("string")).toBe(false);
    expect(isMountPoint(123)).toBe(false);
    expect(isMountPoint([])).toBe(false);
    expect(isMountPoint({})).toBe(false);
    expect(isMountPoint({ notMountPoint: "/" })).toBe(false);
    expect(isMountPoint({ mountPoint: "" })).toBe(false);
    expect(isMountPoint({ mountPoint: "   " })).toBe(false);
    expect(isMountPoint({ mountPoint: null })).toBe(false);
    expect(isMountPoint({ mountPoint: undefined })).toBe(false);
  });
});
