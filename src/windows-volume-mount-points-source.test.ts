import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { _dirname } from "./dirname";

describe("Windows logical-drive enumeration", () => {
  let source: string;

  beforeAll(async () => {
    source = await readFile(
      join(_dirname(), "windows", "volume_mount_points.cpp"),
      "utf8",
    );
  });

  it("retries if the drive set grows between sizing and filling", () => {
    expect(source).toContain("while (true)");
    expect(source).toContain("if (copied < size)");
    expect(source).toContain("size = copied");
    const retryCheck = source.indexOf("if (copied < size)");
    const parse = source.indexOf("for (LPWSTR drive = drives.data()");
    expect(retryCheck).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(retryCheck);
  });

  it("makes no untimed volume call", () => {
    // Only the FindFirstFileExW probe used to be timed. GetVolumeInformationW
    // ran here, unbounded, once a drive reported healthy — so a drive that
    // answered the probe and then stalled hung the caller's promise forever,
    // and getAllVolumeMetadata() inherited the hang. It now runs inside the
    // timed per-drive callback in src/windows/drive_status.h.
    expect(source).not.toMatch(/GetVolumeInformationW\s*\(/);
    expect(source).toContain("CheckDrives(paths, timeoutMs_)");
    expect(source).toContain("checks[i].volumeInfo");
  });

  it("leaves GetDriveTypeW outside the timed callback", () => {
    // Measured, not assumed: GetDriveTypeW classifies a mapped drive as
    // DRIVE_REMOTE from its DosDevices symlink target without touching the
    // network. 1000 calls against drive letters pointing at an unroutable UNC
    // path (in \\??\\UNC, \\Device\\Mup and \\Device\\LanmanRedirector form)
    // took 0.5-0.8 ms in total, max 0.144 ms per call — including while
    // GetVolumeInformationW was blocked 21 s on the same letter.
    expect(source).toContain("GetDriveTypeW(drive)");
    const driveType = source.indexOf("GetDriveTypeW(drive)");
    const check = source.indexOf("CheckDrives(paths, timeoutMs_)");
    expect(driveType).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(driveType);
  });
});
