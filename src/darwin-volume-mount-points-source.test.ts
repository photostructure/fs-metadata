import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { _dirname } from "./dirname";

describe("macOS mount-point shallow enumeration", () => {
  let source: string;

  beforeAll(async () => {
    source = await readFile(
      join(_dirname(), "darwin", "volume_mount_points.cpp"),
      "utf8",
    );
  });

  it("forwards skipHealthProbes into the native worker", () => {
    expect(source).toContain("options.skipHealthProbes");
    expect(source).toMatch(
      /make_shared<GetVolumeMountPointsWorker>\(\s*options\.timeoutMs,\s*options\.skipHealthProbes\)/,
    );
  });

  it("returns classified mount points before starting accessibility probes", () => {
    const executeStart = source.indexOf("void Execute() override");
    const executeEnd = source.indexOf("Napi::Value ToValue", executeStart);
    const execute = source.slice(executeStart, executeEnd);

    expect(execute).toMatch(
      /allMountPoints\.push_back\(std::move\(mp\)\);[\s\S]*if \(skipHealthProbes_\) \{\s*mountPoints_ = std::move\(allMountPoints\);\s*return;\s*\}[\s\S]*StartAccessProbe\(mp\.mountPoint\)/,
    );
    expect(execute.match(/StartAccessProbe\(/g)).toHaveLength(1);
  });
});
