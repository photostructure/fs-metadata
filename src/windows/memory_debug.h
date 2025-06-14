// src/windows/memory_debug.h
#pragma once

#ifdef _WIN32
#ifdef _DEBUG

#define _CRTDBG_MAP_ALLOC
#include <crtdbg.h>
#include <stdlib.h>

namespace FSMeta {

class MemoryDebugger {
public:
    static void Initialize() {
        // Enable memory leak detection
        _CrtSetDbgFlag(_CRTDBG_ALLOC_MEM_DF | _CRTDBG_LEAK_CHECK_DF);
        
        // Report to stderr
        _CrtSetReportMode(_CRT_WARN, _CRTDBG_MODE_FILE);
        _CrtSetReportFile(_CRT_WARN, _CRTDBG_FILE_STDERR);
        _CrtSetReportMode(_CRT_ERROR, _CRTDBG_MODE_FILE);
        _CrtSetReportFile(_CRT_ERROR, _CRTDBG_FILE_STDERR);
        _CrtSetReportMode(_CRT_ASSERT, _CRTDBG_MODE_FILE);
        _CrtSetReportFile(_CRT_ASSERT, _CRTDBG_FILE_STDERR);
    }
    
    static void SetBreakOnAllocation(long allocationNumber) {
        _CrtSetBreakAlloc(allocationNumber);
    }
    
    static void CheckMemory() {
        _ASSERTE(_CrtCheckMemory());
    }
    
    static void DumpMemoryLeaks() {
        _CrtDumpMemoryLeaks();
    }
    
    // RAII helper for memory state checkpoints
    class MemoryCheckpoint {
        _CrtMemState startState;
        const char* checkpointName;
        
    public:
        explicit MemoryCheckpoint(const char* name) : checkpointName(name) {
            _CrtMemCheckpoint(&startState);
        }
        
        ~MemoryCheckpoint() {
            _CrtMemState endState, diffState;
            _CrtMemCheckpoint(&endState);
            
            if (_CrtMemDifference(&diffState, &startState, &endState)) {
                _RPT1(_CRT_WARN, "Memory leaks detected in %s:\n", checkpointName);
                _CrtMemDumpStatistics(&diffState);
                _CrtMemDumpAllObjectsSince(&startState);
            }
        }
    };
};

// Macros for easier use
#define INIT_MEMORY_DEBUG() FSMeta::MemoryDebugger::Initialize()
#define MEMORY_CHECKPOINT(name) FSMeta::MemoryDebugger::MemoryCheckpoint _checkpoint(name)
#define CHECK_MEMORY() FSMeta::MemoryDebugger::CheckMemory()
#define DUMP_MEMORY_LEAKS() FSMeta::MemoryDebugger::DumpMemoryLeaks()

} // namespace FSMeta

#else // Not debug build

#define INIT_MEMORY_DEBUG()
#define MEMORY_CHECKPOINT(name)
#define CHECK_MEMORY()
#define DUMP_MEMORY_LEAKS()

#endif // _DEBUG
#endif // _WIN32