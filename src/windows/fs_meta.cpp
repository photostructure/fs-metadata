#include "fs_meta.h"
#include <iomanip>
#include <memory>
#include <sstream>
#include <string>
#include <vector>
#include <windows.h>
#include <winnetwk.h>

namespace FSMeta {

// Constants
constexpr size_t ERROR_BUFFER_SIZE = 256;
constexpr DWORD BUFFER_SIZE = MAX_PATH + 1;

// Drive status enumeration - keeping as basic enum for performance
enum DriveStatus {
    Unknown,
    Unavailable,
    Healthy,
    Disconnected,
    Error,
    NoMedia
};

// Exception class for filesystem operations
class FSException : public std::runtime_error {
public:
    explicit FSException(const std::string& message) : std::runtime_error(message) {}
};

// Helper functions
inline std::string CreateErrorMessage(const char* operation, DWORD error) {
    std::ostringstream oss;
    oss << operation << " failed with error: " << error;
    return oss.str();
}

inline std::string FormatVolumeUUID(DWORD serialNumber) {
    std::stringstream ss;
    ss << std::uppercase << std::hex << std::setfill('0') << std::setw(8) << serialNumber;
    return ss.str();
}

inline void ValidatePath(const std::string& path) {
    if (path.empty() || path.length() >= MAX_PATH) {
        throw FSException("Invalid path length");
    }
}

inline const char* DriveStatusToString(DriveStatus status) {
    switch (status) {
        case Unknown: return "unknown";
        case Unavailable: return "unavailable";
        case Healthy: return "healthy";
        case Disconnected: return "disconnected";
        case Error: return "error";
        case NoMedia: return "no_media";
        default: return "unknown";
    }
}

// Drive status determination with performance optimization
DriveStatus GetDriveStatus(const std::string& path) {
    UINT driveType = GetDriveTypeA(path.c_str());
    
    // First check if drive is accessible
    std::string mountPoint = path;
    if (mountPoint.back() != '\\') {
        mountPoint += '\\';
    }
    
    // Use stack-allocated arrays for better performance
    char volumeName[BUFFER_SIZE] = {0};
    char fileSystem[BUFFER_SIZE] = {0};
    DWORD serialNumber = 0;
    DWORD maxComponentLen = 0;
    DWORD fsFlags = 0;

    bool isAccessible = GetVolumeInformationA(
        mountPoint.c_str(),
        volumeName,
        BUFFER_SIZE,
        &serialNumber,
        &maxComponentLen,
        &fsFlags,
        fileSystem,
        BUFFER_SIZE
    );

    switch (driveType) {
        case DRIVE_UNKNOWN:
            return Unknown;
        case DRIVE_NO_ROOT_DIR:
            return Unavailable;
        case DRIVE_REMOVABLE:
            return isAccessible ? Healthy : Disconnected;
        case DRIVE_FIXED:
            return isAccessible ? Healthy : Error;
        case DRIVE_REMOTE:
            if (!isAccessible) {
                DWORD result = WNetGetConnectionA(path.substr(0, 2).c_str(), nullptr, nullptr);
                return (result == ERROR_NOT_CONNECTED) ? Disconnected : Error;
            }
            return Healthy;
        case DRIVE_CDROM:
            return isAccessible ? Healthy : NoMedia;
        case DRIVE_RAMDISK:
            return isAccessible ? Healthy : Error;
        default:
            return Unknown;
    }
}

// Volume metadata structure
struct VolumeMetadata {
    VolumeMetadata() : size(0), used(0), available(0), remote(false) {}
    
    std::string label;
    std::string fileSystem;
    double size;
    double used;
    double available;
    std::string uuid;
    std::string mountFrom;
    DriveStatus status;
    bool remote;
};

class GetVolumeMountPointsWorker : public Napi::AsyncWorker {
public:
    explicit GetVolumeMountPointsWorker(const Napi::Promise::Deferred& deferred)
        : Napi::AsyncWorker(deferred.Env()), deferred_(deferred) {}

    void Execute() override {
        try {
            DWORD length = GetLogicalDriveStringsA(0, nullptr);
            if (length == 0) {
                throw FSException(CreateErrorMessage("GetLogicalDriveStrings", GetLastError()));
            }

            std::vector<char> driveStrings(length);
            if (GetLogicalDriveStringsA(length, driveStrings.data()) == 0) {
                throw FSException(CreateErrorMessage("GetLogicalDriveStrings data", GetLastError()));
            }

            for (const char* drive = driveStrings.data(); *drive; drive += strlen(drive) + 1) {
                mountPoints.push_back(std::string(drive));
            }
        } catch (const std::exception& e) {
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
    Napi::Promise::Deferred deferred_;
    std::vector<std::string> mountPoints;
};

class GetVolumeMetadataWorker : public Napi::AsyncWorker {
public:
    GetVolumeMetadataWorker(const std::string& path, const Napi::Promise::Deferred& deferred)
        : Napi::AsyncWorker(deferred.Env()), mountPoint(path), deferred_(deferred) {
        ValidatePath(path);
    }

    void Execute() override {
        try {
            // Get drive status first
            metadata.status = GetDriveStatus(mountPoint);

            // If drive is not accessible, skip further checks
            if (metadata.status == Disconnected || metadata.status == Unavailable || 
                metadata.status == Error || metadata.status == NoMedia) {
                return;
            }

            // Use stack-allocated arrays for better performance
            char volumeName[BUFFER_SIZE] = {0};
            char fileSystem[BUFFER_SIZE] = {0};
            DWORD serialNumber = 0;
            DWORD maxComponentLen = 0;
            DWORD fsFlags = 0;

            if (!GetVolumeInformationA(
                    mountPoint.c_str(),
                    volumeName,
                    BUFFER_SIZE,
                    &serialNumber,
                    &maxComponentLen,
                    &fsFlags,
                    fileSystem,
                    BUFFER_SIZE)) {
                throw FSException(CreateErrorMessage("GetVolumeInformation", GetLastError()));
            }

            metadata.label = volumeName;
            metadata.fileSystem = fileSystem;
            metadata.uuid = FormatVolumeUUID(serialNumber);

            // Get disk space information
            ULARGE_INTEGER totalBytes;
            ULARGE_INTEGER freeBytes;
            ULARGE_INTEGER totalFreeBytes;

            if (!GetDiskFreeSpaceExA(mountPoint.c_str(), &freeBytes, &totalBytes, &totalFreeBytes)) {
                throw FSException(CreateErrorMessage("GetDiskFreeSpaceEx", GetLastError()));
            }

            metadata.size = static_cast<double>(totalBytes.QuadPart);
            metadata.available = static_cast<double>(freeBytes.QuadPart);
            metadata.used = metadata.size - metadata.available;

            // Check if drive is remote
            metadata.remote = (GetDriveTypeA(mountPoint.c_str()) == DRIVE_REMOTE);

            // Get network path if the drive is remote
            if (metadata.remote) {
                char remoteName[BUFFER_SIZE] = {0};
                DWORD length = BUFFER_SIZE;
                DWORD result = WNetGetConnectionA(
                    mountPoint.substr(0, 2).c_str(),
                    remoteName,
                    &length
                );

                if (result == NO_ERROR) {
                    metadata.mountFrom = remoteName;
                }
            }
        } catch (const std::exception& e) {
            SetError(e.what());
        }
    }

    void OnOK() override {
        Napi::HandleScope scope(Env());
        Napi::Object result = Napi::Object::New(Env());

        result.Set("label", metadata.label.empty() ? 
            Env().Null() : Napi::String::New(Env(), metadata.label));
        result.Set("fileSystem", metadata.fileSystem.empty() ? 
            Env().Null() : Napi::String::New(Env(), metadata.fileSystem));
        result.Set("size", Napi::Number::New(Env(), metadata.size));
        result.Set("used", Napi::Number::New(Env(), metadata.used));
        result.Set("available", Napi::Number::New(Env(), metadata.available));
        result.Set("uuid", metadata.uuid.empty() ? 
            Env().Null() : Napi::String::New(Env(), metadata.uuid));
        result.Set("remote", Napi::Boolean::New(Env(), metadata.remote));
        result.Set("status", Napi::String::New(Env(), DriveStatusToString(metadata.status)));

        if (metadata.remote && !metadata.mountFrom.empty()) {
            result.Set("mountFrom", Napi::String::New(Env(), metadata.mountFrom));
        }

        deferred_.Resolve(result);
    }

private:
    std::string mountPoint;
    Napi::Promise::Deferred deferred_;
    VolumeMetadata metadata;
};

Napi::Value GetVolumeMountPoints(Napi::Env env) {
    auto deferred = Napi::Promise::Deferred::New(env);
    auto* worker = new GetVolumeMountPointsWorker(deferred);
    worker->Queue();
    return deferred.Promise();
}

Napi::Value GetVolumeMetadata(const Napi::Env& env, const std::string& mountPoint, 
                             const Napi::Object& options) {
    auto deferred = Napi::Promise::Deferred::New(env);
    auto* worker = new GetVolumeMetadataWorker(mountPoint, deferred);
    worker->Queue();
    return deferred.Promise();
}

} // namespace FSMeta