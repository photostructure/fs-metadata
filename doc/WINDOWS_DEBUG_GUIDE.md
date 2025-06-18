# Windows and Alpine Linux Debugging Guide for debuglog.test.ts

## Issue Summary

The debuglog.test.ts file was failing on:

1. **Windows CI**: "Converting circular structure to JSON" error in Jest's message passing system when `execFileSync` threw errors with circular references
2. **Alpine Linux**: `ETIMEDOUT` errors when spawning child processes with `npx`

## Changes Made

1. **Replaced execFileSync with spawnSync**

   - `spawnSync` provides better process control and doesn't throw errors with circular references
   - Added `windowsHide: true` to prevent console windows from appearing on Windows
   - Added `shell: true` on Windows only for proper npx execution
   - Increased timeout to 30 seconds for slower environments like Alpine Linux containers

2. **Enhanced Error Handling**

   - Extract only serializable properties from errors (message, code, status, stderr, stdout)
   - Added detailed logging for Windows-specific debugging
   - Prevent circular reference errors from reaching Jest's worker communication

3. **Improved Child Process Scripts**
   - Added uncaughtException and unhandledRejection handlers
   - Use `process.stdout.write` instead of `console.log` for cleaner output
   - Added detailed error logging with stack traces to stderr

## Manual Testing on Windows

To test these changes on your Windows test box:

1. **Run the specific test file:**

   ```powershell
   npm test -- src/debuglog.test.ts
   ```

2. **Run with verbose output to see debugging info:**

   ```powershell
   npm test -- src/debuglog.test.ts --verbose
   ```

3. **If tests fail, check for:**

   - Console output showing "Windows child process error" with detailed info
   - Error messages, status codes, and stderr output
   - Whether `npx tsx` is available and working correctly

4. **To test individual child scripts directly:**

   ```powershell
   # Test debuglog-child.ts
   $env:NODE_DEBUG="fs-metadata"
   npx tsx src/test-utils/debuglog-child.ts

   # Test debuglog-enabled-child.ts
   $env:NODE_DEBUG="fs-metadata"
   npx tsx src/test-utils/debuglog-enabled-child.ts
   ```

5. **Check for hanging processes:**
   - The tests now have a 5-second timeout
   - If a test hangs, it will fail with a timeout error
   - Check Task Manager for any orphaned node.exe processes

## Debugging Tips

1. **Enable Node.js debugging:**

   ```powershell
   $env:NODE_OPTIONS="--trace-warnings"
   npm test -- src/debuglog.test.ts
   ```

2. **Check npx/tsx availability:**

   ```powershell
   npx --version
   npx tsx --version
   ```

3. **If npx tsx fails, try direct execution:**
   ```powershell
   node_modules/.bin/tsx src/test-utils/debuglog-child.ts
   ```

## Expected Behavior

- All 10 tests in debuglog.test.ts should pass
- No "Converting circular structure to JSON" errors
- Child processes should exit cleanly without hanging
- Detailed error information should be logged on failures

## Rollback Plan

If these changes cause new issues, the previous approach using execFileSync can be restored by reverting this commit. The key difference is the switch from execFileSync to spawnSync and the enhanced error handling.
