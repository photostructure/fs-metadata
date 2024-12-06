// src/common/hidden.h
#pragma once
#include <napi.h>

namespace FSMeta {
// NOTE: LLMs want to declare Worker classes (like GetHiddenWorker) in the
// header for some reason, but that isn't necessary.

Napi::Promise GetHiddenAttribute(const Napi::CallbackInfo &info);
Napi::Promise SetHiddenAttribute(const Napi::CallbackInfo &info);

} // namespace FSMeta