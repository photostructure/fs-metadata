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
});
