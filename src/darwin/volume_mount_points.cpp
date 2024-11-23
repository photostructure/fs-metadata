// src/darwin/volume_mount_points.cpp

#include "./fs_meta.h"
#include <sys/mount.h>
#include <sys/param.h>
#include <vector>

namespace FSMeta {

class GetVolumeMountPointsWorker : public Napi::AsyncWorker {
public:
  GetVolumeMountPointsWorker(const Napi::Promise::Deferred &deferred)
      : Napi::AsyncWorker(deferred.Env()), deferred_(deferred) {}

  void Execute() override {
    try {
      struct statfs *mntbufp;
      int count = getmntinfo(&mntbufp, MNT_WAIT);

      if (count <= 0) {
        throw std::runtime_error("Failed to get mount information");
      }

      for (int i = 0; i < count; i++) {
        MountPoint point;
        point.mountPoint = mntbufp[i].f_mntonname;
        point.fstype = mntbufp[i].f_fstypename;
        mountPoints.push_back(point);
      }
    } catch (const std::exception &e) {
      SetError(e.what());
    }
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    Napi::Array result = Napi::Array::New(Env());

    for (size_t i = 0; i < mountPoints.size(); i++) {
      Napi::Object point = Napi::Object::New(Env());
      point.Set("mountPoint", mountPoints[i].mountPoint);
      point.Set("fstype", mountPoints[i].fstype);
      result.Set(i, point);
    }

    deferred_.Resolve(result);
  }

  void OnError(const Napi::Error &error) override {
    deferred_.Reject(error.Value());
  }

private:
  std::vector<MountPoint> mountPoints;
  Napi::Promise::Deferred deferred_;
};

Napi::Value GetVolumeMountPoints(Napi::Env env) {
  auto deferred = Napi::Promise::Deferred::New(env);
  auto *worker = new GetVolumeMountPointsWorker(deferred);
  worker->Queue();
  return deferred.Promise();
}

} // namespace FSMeta