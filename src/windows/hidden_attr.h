// src/windows/hidden_attr.h
#pragma once
#include <napi.h>
#include <windows.h>

namespace FSMeta {
Napi::Promise GetHiddenAttribute(const Napi::CallbackInfo &info);
Napi::Promise SetHiddenAttribute(const Napi::CallbackInfo &info);
} // namespace FSMeta