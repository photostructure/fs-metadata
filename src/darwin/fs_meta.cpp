// src/darwin/fs_meta.cpp
#include "fs_meta.h"

#include <CoreFoundation/CoreFoundation.h>
#include <DiskArbitration/DiskArbitration.h>
#include <IOKit/IOBSD.h>
#include <IOKit/storage/IOMedia.h>
#include <IOKit/storage/IOStorageProtocolCharacteristics.h>
#include <sys/mount.h>
#include <sys/param.h>
#include <sys/statvfs.h>

namespace FSMeta {

// Helper function to convert CFString to std::string
static std::string CFStringToString(CFStringRef cfString) {
  if (!cfString)
    return "";

  CFIndex length = CFStringGetLength(cfString);
  CFIndex maxSize =
      CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
  std::string result(maxSize, '\0');

  if (!CFStringGetCString(cfString, &result[0], maxSize,
                          kCFStringEncodingUTF8)) {
    return "";
  }

  result.resize(strlen(result.c_str()));
  return result;
}

Napi::Value GetMountpoints(Napi::Env env) {
  Napi::Array result = Napi::Array::New(env);
  struct statfs *mntbufp;
  int count = getmntinfo(&mntbufp, MNT_WAIT);

  if (count <= 0) {
    throw Napi::Error::New(env, "Failed to get mount information");
  }

  for (int i = 0; i < count; i++) {
    result.Set(i, Napi::String::New(env, mntbufp[i].f_mntonname));
  }

  return result;
}

Napi::Value GetVolumeMetadata(Napi::Env env, const std::string &mountpoint) {
  Napi::Object result = Napi::Object::New(env);
  struct statvfs stat;

  if (statvfs(mountpoint.c_str(), &stat) != 0) {
    throw Napi::Error::New(env, "Failed to get volume statistics");
  }

  // Get basic volume information
  result.Set("mountpoint", Napi::String::New(env, mountpoint));
  result.Set("filesystem", Napi::String::New(env, stat.f_fstypename));
  result.Set("size", Napi::Number::New(env, static_cast<double>(stat.f_blocks) *
                                                stat.f_frsize));
  result.Set("used", Napi::Number::New(env, static_cast<double>(stat.f_blocks -
                                                                stat.f_bfree) *
                                                stat.f_frsize));
  result.Set("available",
             Napi::Number::New(env, static_cast<double>(stat.f_bavail) *
                                        stat.f_frsize));
  result.Set("dev", Napi::Number::New(env, stat.f_fsid));

  // Get additional information using DiskArbitration framework
  DASessionRef session = DASessionCreate(kCFAllocatorDefault);
  if (!session) {
    throw Napi::Error::New(env, "Failed to create DiskArbitration session");
  }

  struct statfs fs;
  if (statfs(mountpoint.c_str(), &fs) == 0) {
    DADiskRef disk =
        DADiskCreateFromBSDName(kCFAllocatorDefault, session, fs.f_mntfromname);
    if (disk) {
      CFDictionaryRef description = DADiskCopyDescription(disk);
      if (description) {
        // Get volume name/label
        CFStringRef volumeName = (CFStringRef)CFDictionaryGetValue(
            description, kDADiskDescriptionVolumeNameKey);
        if (volumeName) {
          result.Set("label",
                     Napi::String::New(env, CFStringToString(volumeName)));
        }

        // Get UUID
        CFUUIDRef uuid = (CFUUIDRef)CFDictionaryGetValue(
            description, kDADiskDescriptionVolumeUUIDKey);
        if (uuid) {
          CFStringRef uuidString =
              CFUUIDCreateString(kCFAllocatorDefault, uuid);
          if (uuidString) {
            result.Set("uuid",
                       Napi::String::New(env, CFStringToString(uuidString)));
            CFRelease(uuidString);
          }
        }

        // Check if remote
        CFBooleanRef isNetworkVolume = (CFBooleanRef)CFDictionaryGetValue(
            description, kDADiskDescriptionVolumeNetworkKey);
        if (isNetworkVolume) {
          bool isRemote = CFBooleanGetValue(isNetworkVolume);
          result.Set("remote", Napi::Boolean::New(env, isRemote));

          if (isRemote) {
            // Try to get network share information
            CFURLRef url = (CFURLRef)CFDictionaryGetValue(
                description, kDADiskDescriptionVolumePathKey);
            if (url) {
              CFStringRef urlString = CFURLGetString(url);
              std::string urlStr = CFStringToString(urlString);

              // Parse URL for host and share info
              size_t hostStart = urlStr.find("//") + 2;
              size_t hostEnd = urlStr.find('/', hostStart);
              if (hostStart != std::string::npos &&
                  hostEnd != std::string::npos) {
                std::string host =
                    urlStr.substr(hostStart, hostEnd - hostStart);
                std::string share = urlStr.substr(hostEnd + 1);

                result.Set("remoteHost", Napi::String::New(env, host));
                result.Set("remoteShare", Napi::String::New(env, share));
              }
            }
          }
        }

        CFRelease(description);
      }
      CFRelease(disk);
    }
  }

  CFRelease(session);
  return result;
}

} // namespace FSMeta