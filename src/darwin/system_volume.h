// src/darwin/system_volume.h
//
// Shared macOS system volume detection.
//
// Detection uses two signals combined:
//   1. MNT_SNAPSHOT (statfs f_flags) — catches sealed APFS system snapshots
//      ("/" and /System/Volumes/Recovery on macOS Catalina+).
//   2. MNT_DONTBROWSE + APFS volume role — catches infrastructure volumes
//      under /System/Volumes/* that are hidden from Finder. The "Data" role
//      is excluded because /System/Volumes/Data is the primary user data
//      volume (photos, documents, application data).
//
// Formula: MNT_SNAPSHOT || (MNT_DONTBROWSE && hasApfsRole && role != "Data")
//
// This is future-proof: new Apple infrastructure roles with MNT_DONTBROWSE
// are auto-detected without maintaining a whitelist.
//
// Non-APFS MNT_DONTBROWSE mounts (e.g., devfs at /dev) fall through to
// TypeScript fstype/path heuristics.
//
// See doc/system-volume-detection.md for the full rationale.
// See: mount(2), sys/mount.h, IOKit/IOKitLib.h

#pragma once

#include "../common/debug_log.h"
#include "raii_utils.h"
#include <DiskArbitration/DiskArbitration.h>
#include <IOKit/IOKitLib.h>
#include <string>
#include <sys/mount.h>

namespace FSMeta {

// Result of APFS volume role detection + system volume classification.
struct VolumeRoleResult {
  bool isSystemVolume = false;
  std::string role; // e.g., "System", "Data", "VM", "" if unknown
};

// Extract the APFS volume role string via IOKit for a given DiskArbitration
// disk ref. For snapshots (e.g., disk3s7s1), walks one parent up in the
// IOService plane to find the parent volume's role.
// Returns the first role string found, or "" if no role can be determined.
inline std::string GetApfsVolumeRole(DADiskRef disk) {
  if (!disk) {
    return "";
  }

  IOObjectGuard media(DADiskCopyIOMedia(disk));
  if (!media.isValid()) {
    DEBUG_LOG("[GetApfsVolumeRole] Failed to get IOMedia");
    return "";
  }

  // Check the volume's own Role property first
  CFReleaser<CFArrayRef> role(
      static_cast<CFArrayRef>(IORegistryEntryCreateCFProperty(
          media.get(), CFSTR("Role"), kCFAllocatorDefault, 0)));

  // If no Role on this entry, try the parent (handles snapshot → volume case:
  // disk3s7s1 (snapshot) → disk3s7 (volume with System role))
  IOObjectGuard parent;
  if (!role.isValid()) {
    io_registry_entry_t parentRef = 0;
    kern_return_t kr =
        IORegistryEntryGetParentEntry(media.get(), kIOServicePlane, &parentRef);
    if (kr == KERN_SUCCESS) {
      parent = IOObjectGuard(parentRef);
      role.reset(static_cast<CFArrayRef>(IORegistryEntryCreateCFProperty(
          parent.get(), CFSTR("Role"), kCFAllocatorDefault, 0)));
    }
  }

  std::string result;
  if (role.isValid() && CFGetTypeID(role.get()) == CFArrayGetTypeID()) {
    CFIndex count = CFArrayGetCount(role.get());
    if (count > 0) {
      CFStringRef roleStr =
          static_cast<CFStringRef>(CFArrayGetValueAtIndex(role.get(), 0));
      if (roleStr && CFGetTypeID(roleStr) == CFStringGetTypeID()) {
        char buf[64];
        if (CFStringGetCString(roleStr, buf, sizeof(buf),
                               kCFStringEncodingUTF8)) {
          DEBUG_LOG("[GetApfsVolumeRole] Role: %s", buf);
          result = buf;
        }
      }
    }
  }

  // IOObjectGuard destructors automatically release media and parent
  return result;
}

// Classify a macOS volume as system or user using mount flags and APFS role.
//
// Detection formula:
//   MNT_SNAPSHOT || (MNT_DONTBROWSE && hasApfsRole && role != "Data")
//
// - MNT_SNAPSHOT alone catches sealed APFS system snapshots (/ and Recovery)
// - MNT_DONTBROWSE combined with an APFS role catches infrastructure volumes
//   (VM, Preboot, Update, Hardware, xART, etc.) while excluding the Data
//   volume which contains user files
// - Non-APFS MNT_DONTBROWSE mounts (devfs, NFS with nobrowse) are left for
//   TypeScript heuristics
inline VolumeRoleResult ClassifyMacVolume(const char *bsdDeviceName,
                                          uint32_t f_flags,
                                          DASessionRef session) {
  VolumeRoleResult result;

  // Layer 1: MNT_SNAPSHOT alone → system (sealed APFS snapshot)
  if (f_flags & MNT_SNAPSHOT) {
    result.isSystemVolume = true;
  }

  // Layer 2: APFS role via IOKit (if DA session available)
  if (session && bsdDeviceName) {
    // Strip "/dev/" prefix if present
    const char *bsdName = bsdDeviceName;
    if (strncmp(bsdName, "/dev/", 5) == 0) {
      bsdName += 5;
    }

    CFReleaser<DADiskRef> disk(
        DADiskCreateFromBSDName(kCFAllocatorDefault, session, bsdName));
    if (disk.isValid()) {
      result.role = GetApfsVolumeRole(disk.get());

      // MNT_DONTBROWSE + known APFS role that isn't Data → system
      if (!result.role.empty() && result.role != "Data" &&
          (f_flags & MNT_DONTBROWSE)) {
        result.isSystemVolume = true;
      }
    } else {
      DEBUG_LOG("[ClassifyMacVolume] Failed to create disk ref for %s",
                bsdName);
    }
  }

  DEBUG_LOG("[ClassifyMacVolume] %s -> role=%s, isSystem=%s",
            bsdDeviceName ? bsdDeviceName : "(null)", result.role.c_str(),
            result.isSystemVolume ? "true" : "false");

  return result;
}

// Lightweight fallback using only statfs f_flags (no DA/IOKit needed).
// MNT_SNAPSHOT catches sealed APFS system snapshots ("/" and Recovery).
inline VolumeRoleResult ClassifyMacVolumeByFlags(uint32_t f_flags) {
  VolumeRoleResult result;
  result.isSystemVolume = (f_flags & MNT_SNAPSHOT) != 0;
  return result;
}

} // namespace FSMeta
