// src/common/hidden.h
#pragma once
#include <napi.h>

namespace FSMeta {
Napi::Promise GetHiddenAttribute(const Napi::CallbackInfo &info);
Napi::Promise SetHiddenAttribute(const Napi::CallbackInfo &info);
} // namespace FSMeta