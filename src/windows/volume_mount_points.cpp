// src/windows/volume_mount_points.cpp
#include "../common/metadata_worker.h"
#include "./error_utils.h"
#include "./fs_meta.h"
#include <memory>
#include <sstream>
#include <vector>
#include <windows.h>
#include <winnetwk.h>

namespace FSMeta {

namespace {
// RAII wrapper for logical drive enumeration
class LogicalDriveEnumerator {
  std::vector<char> buffer;
  bool valid = false;

public:
  LogicalDriveEnumerator() {
    DWORD length = GetLogicalDriveStringsA(0, nullptr);
    if (length == 0) {
      throw FSException("GetLogicalDriveStrings length query", GetLastError());
    }

    buffer.resize(length);
    if (GetLogicalDriveStringsA(length, buffer.data()) == 0) {
      throw FSException("GetLogicalDriveStrings", GetLastError());
    }
    valid = true;
  }

  // Iterator class for drives
  class iterator {
    const char *current;

  public:
    explicit iterator(const char *ptr) : current(ptr) {}

    iterator &operator++() {
      if (current && *current) {
        current += strlen(current) + 1;
        if (!*current)
          current = nullptr;
      }
      return *this;
    }

    bool operator!=(const iterator &other) const {
      return current != other.current;
    }

    std::string operator*() const { return std::string(current); }
  };

  iterator begin() const { return iterator(valid ? buffer.data() : nullptr); }

  iterator end() const { return iterator(nullptr); }
};

// Helper class for drive status checking
class DriveStatusChecker {
public:
  static bool isAccessible(const std::string &path) {
    char volumeName[MAX_PATH] = {0};
    char fileSystem[MAX_PATH] = {0};
    DWORD serialNumber = 0;
    DWORD maxComponentLen = 0;
    DWORD fsFlags = 0;

    return GetVolumeInformationA(path.c_str(), volumeName, MAX_PATH,
                                 &serialNumber, &maxComponentLen, &fsFlags,
                                 fileSystem, MAX_PATH) != 0;
  }

  static bool isValidNetworkDrive(const std::string &path) {
    std::vector<char> buffer(MAX_PATH);
    DWORD bufferSize = MAX_PATH;
    DWORD result = WNetGetConnectionA(path.substr(0, 2).c_str(), buffer.data(),
                                      &bufferSize);
    return result == NO_ERROR;
  }
};

} // anonymous namespace

class GetVolumeMountPointsWorker : public MetadataWorkerBase {
public:
  explicit GetVolumeMountPointsWorker(const Napi::Promise::Deferred &deferred)
      : MetadataWorkerBase("", deferred) {}

  void Execute() override {
    try {
      std::vector<std::string> validMountPoints;
      validMountPoints.reserve(26); // Maximum possible drives A-Z

      LogicalDriveEnumerator drives;
      for (const auto &drive : drives) {
        try {
          // For network drives, verify connection
          if (GetDriveTypeA(drive.c_str()) == DRIVE_REMOTE) {
            if (DriveStatusChecker::isValidNetworkDrive(drive)) {
              validMountPoints.push_back(drive);
            }
            continue;
          }

          // For local drives, check accessibility
          if (DriveStatusChecker::isAccessible(drive)) {
            validMountPoints.push_back(drive);
          }
        } catch (const FSException &) {
          // Skip problematic drives but continue enumeration
          continue;
        }
      }

      mountPoints = std::move(validMountPoints);

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
  try {
    auto deferred = Napi::Promise::Deferred::New(env);
    auto *worker = new GetVolumeMountPointsWorker(deferred);
    worker->Queue();
    return deferred.Promise();
  } catch (const std::exception &e) {
    auto deferred = Napi::Promise::Deferred::New(env);
    deferred.Reject(Napi::Error::New(env, e.what()).Value());
    return deferred.Promise();
  }
}

} // namespace FSMeta