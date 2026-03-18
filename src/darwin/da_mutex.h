// src/darwin/da_mutex.h
//
// Shared mutex for DiskArbitration operations.
//
// Apple's DiskArbitration framework does not document thread safety for
// concurrent DASession usage across threads. To prevent data races, all DA
// operations (session creation, disk description, IOKit queries via
// ClassifyMacVolume) must be serialized through this mutex.
//
// See: Finding #5 in SECURITY_AUDIT_2025.md (original)
//      Finding #2 in SECURITY_AUDIT_2026.md (mount points regression)

#pragma once

#include <mutex>

namespace FSMeta {

// Defined in volume_metadata.cpp. Serializes all DiskArbitration + IOKit
// operations across both getVolumeMetadata and getVolumeMountPoints workers.
extern std::mutex g_diskArbitrationMutex;

} // namespace FSMeta
