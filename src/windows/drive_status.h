// src/windows/drive_status.h
#pragma once
#include "../common/debug_log.h"
#include "thread_pool.h"
#include "security_utils.h"
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <future>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <windows.h>

namespace FSMeta {

enum class DriveStatus {
    Healthy,
    Timeout,
    Inaccessible,
    Disconnected,
    Unknown
};

inline std::string DriveStatusToString(DriveStatus status) {
    switch (status) {
    case DriveStatus::Healthy:
        return "healthy";
    case DriveStatus::Timeout:
        return "timeout";
    case DriveStatus::Inaccessible:
        return "inaccessible";
    case DriveStatus::Disconnected:
        return "disconnected";
    default:
        return "unknown";
    }
}

class DriveStatusChecker {
private:
    static DriveStatus MapErrorToDriveStatus(DWORD error) {
        switch (error) {
        case ERROR_SUCCESS:
            return DriveStatus::Healthy;
            
        case ERROR_FILE_NOT_FOUND:
        case ERROR_PATH_NOT_FOUND:
        case ERROR_ACCESS_DENIED:
        case ERROR_LOGON_FAILURE:
        case ERROR_SHARING_VIOLATION:
            return DriveStatus::Inaccessible;

        case ERROR_BAD_NET_NAME:
        case ERROR_NETWORK_UNREACHABLE:
        case ERROR_NOT_CONNECTED:
        case ERROR_NETWORK_ACCESS_DENIED:
        case ERROR_BAD_NETPATH:
        case ERROR_NO_NET_OR_BAD_PATH:
            return DriveStatus::Disconnected;

        default:
            return DriveStatus::Unknown;
        }
    }
    
    static DriveStatus CheckDriveInternal(const std::string& path) {
        DEBUG_LOG("[DriveStatusChecker] Checking drive: %s", path.c_str());
        
        // Validate path
        if (!SecurityUtils::IsPathSecure(path)) {
            DEBUG_LOG("[DriveStatusChecker] Path failed security check: %s", path.c_str());
            return DriveStatus::Inaccessible;
        }
        
        // Ensure path ends with backslash for FindFirstFileEx
        std::string searchPath = path;
        if (!searchPath.empty() && searchPath.back() != '\\') {
            searchPath += '\\';
        }
        searchPath += "*";
        
        WIN32_FIND_DATAA findData;
        HandleGuard findHandle(FindFirstFileExA(
            searchPath.c_str(),
            FindExInfoBasic,
            &findData,
            FindExSearchNameMatch,
            nullptr,
            FIND_FIRST_EX_LARGE_FETCH | FIND_FIRST_EX_ON_DISK_ENTRIES_ONLY
        ));
        
        if (!findHandle) {
            DWORD error = GetLastError();
            DEBUG_LOG("[DriveStatusChecker] FindFirstFileEx failed for %s: %lu", 
                     path.c_str(), error);
            return MapErrorToDriveStatus(error);
        }
        
        // Successfully opened - drive is healthy
        FindClose(findHandle.release());
        DEBUG_LOG("[DriveStatusChecker] Drive %s is healthy", path.c_str());
        return DriveStatus::Healthy;
    }
    
public:
    static std::future<DriveStatus> CheckDriveAsync(const std::string& path, 
                                                   DWORD timeoutMs = 5000) {
        auto promise = std::make_shared<std::promise<DriveStatus>>();
        auto future = promise->get_future();
        
        // Use a shared state for timeout handling
        auto state = std::make_shared<std::atomic<bool>>(false);
        
        GetGlobalThreadPool().Submit([path, promise, state, timeoutMs]() {
            // Set up timeout
            auto startTime = std::chrono::steady_clock::now();
            
            // Perform the check
            DriveStatus status = CheckDriveInternal(path);
            
            // Check if we've timed out
            auto elapsed = std::chrono::steady_clock::now() - startTime;
            if (elapsed > std::chrono::milliseconds(timeoutMs)) {
                status = DriveStatus::Timeout;
            }
            
            // Only set the promise if we haven't been cancelled
            if (!state->load()) {
                promise->set_value(status);
            }
        });
        
        // Handle timeout in the caller
        if (timeoutMs != INFINITE) {
            std::thread([promise, state, timeoutMs]() {
                std::this_thread::sleep_for(std::chrono::milliseconds(timeoutMs));
                if (!state->exchange(true)) {
                    try {
                        promise->set_value(DriveStatus::Timeout);
                    } catch (...) {
                        // Promise already satisfied
                    }
                }
            }).detach();
        }
        
        return future;
    }
    
    static DriveStatus CheckDrive(const std::string& path, DWORD timeoutMs = 5000) {
        try {
            auto future = CheckDriveAsync(path, timeoutMs);
            
            if (future.wait_for(std::chrono::milliseconds(timeoutMs)) == 
                std::future_status::timeout) {
                return DriveStatus::Timeout;
            }
            
            return future.get();
        } catch (...) {
            DEBUG_LOG("[DriveStatusChecker] Exception checking drive %s", path.c_str());
            return DriveStatus::Unknown;
        }
    }
    
    static std::vector<DriveStatus> CheckMultipleDrives(
        const std::vector<std::string>& paths, 
        DWORD timeoutMs = 5000) {
        
        std::vector<std::future<DriveStatus>> futures;
        futures.reserve(paths.size());
        
        // Launch all checks concurrently
        for (const auto& path : paths) {
            futures.push_back(CheckDriveAsync(path, timeoutMs));
        }
        
        // Collect results
        std::vector<DriveStatus> results;
        results.reserve(paths.size());
        
        for (size_t i = 0; i < futures.size(); ++i) {
            try {
                if (futures[i].wait_for(std::chrono::milliseconds(timeoutMs)) == 
                    std::future_status::timeout) {
                    results.push_back(DriveStatus::Timeout);
                } else {
                    results.push_back(futures[i].get());
                }
            } catch (...) {
                DEBUG_LOG("[DriveStatusChecker] Exception getting result for drive %s", 
                         paths[i].c_str());
                results.push_back(DriveStatus::Unknown);
            }
        }
        
        return results;
    }
};

// Compatibility wrapper for existing code
inline std::vector<DriveStatus> CheckDriveStatus(
    const std::vector<std::string>& paths, 
    DWORD timeoutMs = 5000) {
    return DriveStatusChecker::CheckMultipleDrives(paths, timeoutMs);
}

inline DriveStatus CheckDriveStatus(const std::string& path, DWORD timeoutMs = 5000) {
    return DriveStatusChecker::CheckDrive(path, timeoutMs);
}

} // namespace FSMeta