// src/darwin/hidden.h
#pragma once
#include "../common/hidden.h"
#include <napi.h>

namespace FSMeta {

class GetHiddenWorker : public Napi::AsyncWorker {
public:
  GetHiddenWorker(std::string path, Napi::Promise::Deferred deferred);
  void Execute() override;
  void OnOK() override;
  void OnError(const Napi::Error &error) override;

private:
  std::string path_;
  Napi::Promise::Deferred deferred_;
  bool is_hidden_;
};

class SetHiddenWorker : public Napi::AsyncWorker {
public:
  SetHiddenWorker(std::string path, bool hidden,
                  Napi::Promise::Deferred deferred);
  void Execute() override;
  void OnOK() override;
  void OnError(const Napi::Error &error) override;

private:
  std::string path_;
  bool hidden_;
  Napi::Promise::Deferred deferred_;
};

} // namespace FSMeta