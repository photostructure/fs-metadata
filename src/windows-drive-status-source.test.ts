import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { _dirname } from "./dirname";

describe("Windows drive-status implementation", () => {
  let source: string;

  beforeAll(async () => {
    source = await readFile(
      join(_dirname(), "windows", "drive_status.h"),
      "utf8",
    );
  });

  it("marks blocking callbacks as long-running instead of using a fixed pool", () => {
    expect(source).toContain("TrySubmitThreadpoolCallback");
    expect(source).not.toContain('include "thread_pool.h"');
    expect(source).not.toContain("GetGlobalThreadPool");
    // Replacement capacity must be requested BEFORE the blocking probe runs;
    // CallbackMayRunLong after CheckDriveInternal would be pointless.
    const mayRunLong = source.indexOf("CallbackMayRunLong(instance)");
    const probe = source.indexOf("CheckDriveInternal(task->path)");
    expect(mayRunLong).toBeGreaterThan(-1);
    expect(probe).toBeGreaterThan(-1);
    expect(mayRunLong).toBeLessThan(probe);
  });

  it("pins the addon DLL for the callback's lifetime", () => {
    // Guards against a use-after-unload crash when a Node Worker that is the
    // addon's last loader tears down while a probe is still blocked in the pool.
    expect(source).toContain("GetModuleHandleEx");
    expect(source).toContain("FreeLibraryWhenCallbackReturns");
  });

  it("treats only an empty wildcard search as accessible, not other errors", () => {
    // ERROR_FILE_NOT_FOUND -> Healthy must be guarded by the exact conditional,
    // with every other error still classified by MapErrorToDriveStatus.
    expect(source).toMatch(
      /if\s*\(\s*error\s*==\s*ERROR_FILE_NOT_FOUND\s*\)\s*\{\s*return\s+DriveStatus::Healthy;/,
    );
    expect(source).toContain("return MapErrorToDriveStatus(error);");
  });

  // A timed-out callback is abandoned, not cancelled. Without coalescing,
  // every getVolumeMountPoints(), getAllVolumeMetadata(), getVolumeMetadata(),
  // or getVolumeMetadataForPath() call against a stalled mapped drive adds
  // another stuck process-pool callback. Only the shape of the registry is
  // checkable here: the pile-up itself needs a provider that stalls
  // indefinitely, which no API on this platform can synthesize.
  describe("in-flight check registry", () => {
    it("consults the registry before submitting a work item", () => {
      expect(source).toContain("std::mutex mutex;");
      expect(source).toContain(
        "std::unordered_map<std::string, InflightCheck>",
      );
      expect(source).toContain("std::shared_future<DriveStatus>");

      // A lookup after the submit would coalesce nothing.
      const lookup = source.indexOf("registry->inflight.find(path)");
      const submit = source.indexOf("TrySubmitThreadpoolCallback(");
      expect(lookup).toBeGreaterThan(-1);
      expect(submit).toBeGreaterThan(lookup);
    });

    it("caps distinct in-flight checks like the macOS probe registry", () => {
      // src/darwin/volume_mount_points.cpp holds at most 64 distinct probes.
      expect(source).toMatch(/kMaxInflightChecks\s*=\s*64/);
      expect(source).toContain(
        "registry->inflight.size() >= kMaxInflightChecks",
      );
    });

    it("keeps the registry alive past static destruction", () => {
      // Detached pool work may outlive static destructors, exactly as on
      // macOS, so the state is deliberately leaked rather than destroyed.
      expect(source).toMatch(/static\s+CheckRegistry\s*\*const\s+registry\s*=/);
    });

    it("retires an entry only after both futures settle", () => {
      // A joiner that found the entry under the lock must never be left
      // waiting on a promise nobody will satisfy.
      const settleStatus = source.indexOf(
        "Settle(*task->status, task->statusSettled, DriveStatus::Unknown)",
      );
      const settleVolumeInfo = source.indexOf(
        "Settle(*task->volumeInfo, task->volumeInfoSettled, DriveVolumeInfo{})",
      );
      const erase = source.indexOf("registry->inflight.erase(task->path)");
      expect(settleStatus).toBeGreaterThan(-1);
      expect(settleVolumeInfo).toBeGreaterThan(settleStatus);
      expect(erase).toBeGreaterThan(settleVolumeInfo);
    });
  });

  describe("timed volume information", () => {
    it("reads the filesystem type inside the timed callback", () => {
      // GetVolumeInformationW used to run in volume_mount_points.cpp with no
      // deadline at all. Measured on a drive letter pointing at an unroutable
      // UNC path: 21,047 ms before it returned ERROR_BAD_NETPATH.
      expect(source).toContain("GetVolumeInformationW(");
      expect(source).toContain("FILE_READ_ONLY_VOLUME");
    });

    it("publishes the status before reading volume information", () => {
      // getVolumeMetadata() waits only on the status future. Making it wait
      // for the enumeration-only GetVolumeInformationW would double its stall
      // on a drive that answers the probe and then blocks.
      const publishStatus = source.indexOf(
        "Settle(*task->status, task->statusSettled, status)",
      );
      const readVolumeInfo = source.indexOf(
        "ReadVolumeInformation(task->path)",
      );
      expect(publishStatus).toBeGreaterThan(-1);
      expect(readVolumeInfo).toBeGreaterThan(publishStatus);
    });

    it("settles each promise exactly once instead of catching a second set", () => {
      // node's common.gypi compiles this addon with _HAS_EXCEPTIONS=0, so
      // MSVC's standard library calls std::terminate() where it would throw
      // promise_already_satisfied. Verified: a retirement backstop that just
      // re-set the value killed the process on the second enumeration, with
      // the surrounding catch (...) never reached.
      expect(source).toContain("bool statusSettled = false;");
      expect(source).toContain("bool volumeInfoSettled = false;");
      expect(source).toMatch(
        /if\s*\(settled\)\s*\{\s*return;\s*\}\s*settled\s*=\s*true;\s*promise\.set_value/,
      );
      expect(source).toMatch(
        /if\s*\(settled\)\s*\{\s*return;\s*\}\s*settled\s*=\s*true;\s*promise\.set_exception/,
      );
    });

    it("asks for volume information only after a healthy probe", () => {
      // Re-entering a provider that just failed buys nothing and can block.
      expect(source).toMatch(/status\s*!=\s*DriveStatus::Healthy/);
    });

    it("never reports healthy when the volume query did not answer", () => {
      // MountPoint::ToObject() serializes isReadOnly unconditionally and
      // compactValues() keeps `false`, so a healthy result from a query that
      // never answered would tell callers an unread volume is writable. Both
      // no-answer paths therefore downgrade the status. A query that answers
      // FALSE is deliberately untouched: that has always reported healthy with
      // both fields at their defaults.
      const volumeInfoWait = source.indexOf(
        "Settled(check.volumeInfo, RemainingBudget(timeoutMs, startTime))",
      );
      expect(volumeInfoWait).toBeGreaterThan(-1);
      const afterWait = source.slice(volumeInfoWait);
      // The timeout branch reports Timeout before returning.
      expect(afterWait).toMatch(
        /result\.status\s*=\s*DriveStatus::Timeout;\s*return result;/,
      );
      // Both exception branches discard the result rather than keep Healthy.
      expect(
        afterWait.split("return DriveCheckResult{};").length - 1,
      ).toBeGreaterThanOrEqual(2);
    });
  });
});
