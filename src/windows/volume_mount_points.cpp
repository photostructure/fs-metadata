// src/windows/volume_mount_points.cpp
#include "../common/metadata_worker.h" // Add this include
#include "./fs_meta.h"
#include <sstream>
#include <windows.h>
#include <winnetwk.h>

namespace FSMeta {

class GetVolumeMountPointsWorker
    : public MetadataWorkerBase { // Inherit from base class
public:
  explicit GetVolumeMountPointsWorker(const Napi::Promise::Deferred &deferred)
      : MetadataWorkerBase("", deferred) {
  } // Pass empty mountPoint since we list all

  void Execute() override {
    try {
      DWORD length = GetLogicalDriveStringsA(0, nullptr);
      if (length == 0) {
        throw FSException(
            CreateErrorMessage("GetLogicalDriveStrings", GetLastError()));
      }

      std::vector<char> driveStrings(length);
      if (GetLogicalDriveStringsA(length, driveStrings.data()) == 0) {
        throw FSException(
            CreateErrorMessage("GetLogicalDriveStrings data", GetLastError()));
      }

      for (const char *drive = driveStrings.data(); *drive;
           drive += strlen(drive) + 1) {
        mountPoints.push_back(std::string(drive));
      }
    } catch (const std::exception &e) {
      SetError(e.what());
    }
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    auto result = Napi::Array::New(Env(), mountPoints.size());

    for (size_t i = 0; i < mountPoints.size(); i++) {
      result.Set(i, Napi::String::New(Env(), mountPoints[i]));
    }

    deferred_.Resolve(result);
  }

private:
  std::vector<std::string> mountPoints;
};

Napi::Value GetVolumeMountPoints(Napi::Env env) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GetVolumeMountPointsWorker(deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta