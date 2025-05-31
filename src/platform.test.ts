import { isArm, isLinux, isMacOS, isWindows } from "./platform";

describe("platform", () => {
  it("should have exactly one platform set to true", () => {
    const platforms = [isLinux, isWindows, isMacOS];
    const truePlatforms = platforms.filter((p) => p);
    expect(truePlatforms).toHaveLength(1);
  });

  it("should define isArm for Linux platforms", () => {
    // isArm will be true only on Linux ARM platforms
    expect(typeof isArm).toBe("boolean");
    if (isLinux) {
      // On Linux, isArm depends on the architecture
      expect(isArm).toBe(process.arch.startsWith("arm"));
    } else {
      // On non-Linux platforms, isArm should be false
      expect(isArm).toBe(false);
    }
  });
});
