// src/binding.cpp

#include <napi.h>
#include <string>

#if defined(_WIN32)
#include "windows/fs_meta.h"
#elif defined(__APPLE__)
#include "darwin/fs_meta.h"
#elif defined(__linux__)
#include "linux/fs_meta.h"
#ifdef ENABLE_GIO
#include "linux/gio_utils.h"
#endif
#endif

namespace {

Napi::Value GetVolumeMetadata(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        throw Napi::TypeError::New(env, "String expected for mountPoint");
    }
    
    std::string mountPoint = info[0].As<Napi::String>();
    Napi::Object options = info.Length() > 1 && info[1].IsObject() 
        ? info[1].As<Napi::Object>() 
        : Napi::Object::New(env);
        
    return FSMeta::GetVolumeMetadata(env, mountPoint, options);
}

#ifdef ENABLE_GIO
Napi::Value GetGioMountPoints(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return FSMeta::gio::GetMountPoints(env);
}
#endif

#if defined(_WIN32) || defined(__APPLE__)
Napi::Value GetVolumeMountPoints(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return FSMeta::GetVolumeMountPoints(env);
}
#endif

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    
#if defined(_WIN32) || defined(__APPLE__)
    exports.Set("getVolumeMountPoints",
        Napi::Function::New(env, GetVolumeMountPoints));
#endif

    exports.Set("getVolumeMetadata", 
        Napi::Function::New(env, GetVolumeMetadata));

#ifdef ENABLE_GIO
    exports.Set("getGioMountPoints",
        Napi::Function::New(env, GetGioMountPoints));
#endif

    return exports;
}

NODE_API_MODULE(node_fs_meta, Init)

} // namespace