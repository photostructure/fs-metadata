# Windows Debug Memory Check Script
# Based on .github/workflows/windows-debug.yml
# This script builds the native module in debug mode and runs tests with memory leak detection

param(
    [switch]$SecurityTestsOnly = $false
)

# Set error action preference for CI
if ($env:CI -eq 'true') {
    $ErrorActionPreference = 'Stop'
}

Write-Host "`n=== Windows Debug Memory Check ===" -ForegroundColor Cyan

# Function to run commands and check for errors
function Invoke-Command {
    param(
        [string]$Command,
        [string]$Description
    )
    
    Write-Host "`n> $Description" -ForegroundColor Yellow
    Write-Host "  Command: $Command" -ForegroundColor DarkGray
    
    try {
        Invoke-Expression $Command
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code $LASTEXITCODE"
        }
    }
    catch {
        Write-Host "ERROR: $Description failed!" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
}

# Set environment variables for debug build
Write-Host "`nSetting debug environment variables..." -ForegroundColor Green
$env:DEBUG = "1"
$env:_CRTDBG_MAP_ALLOC = "1"
$env:NODE_ENV = "test"
$env:TEST_MEMORY = "1"

# Always force a clean rebuild to ensure we have a fresh debug build
Write-Host "`nForcing clean rebuild for debug testing..." -ForegroundColor Green
Invoke-Command "npx node-gyp clean" "Cleaning previous build"

# Also remove the build directory to ensure complete cleanup
if (Test-Path "build") {
    Write-Host "Removing build directory for complete cleanup..." -ForegroundColor Yellow
    Remove-Item -Path "build" -Recurse -Force -ErrorAction SilentlyContinue
}

# Configure and build with node-gyp in debug mode
Invoke-Command "npx node-gyp configure --debug" "Configuring debug build"
Invoke-Command "npx node-gyp build --debug" "Building in debug mode"

# Verify the debug build exists
$debugBuildPath = "build\Debug\fs_metadata.node"
if (-not (Test-Path $debugBuildPath)) {
    Write-Host "ERROR: Debug build not found at $debugBuildPath" -ForegroundColor Red
    exit 1
}
Write-Host "Debug build verified at $debugBuildPath" -ForegroundColor Green

# Handle debug build loading issues on Windows
if ($SecurityTestsOnly) {
    Write-Host "`nWindows Debug Build Status:" -ForegroundColor Yellow
    Write-Host "Debug builds on Windows often fail to load due to:" -ForegroundColor Yellow
    Write-Host "  - Missing debug CRT dependencies (ucrtbased.dll, vcruntime*d.dll)" -ForegroundColor Yellow
    Write-Host "  - UNC path issues with Node.js module loader" -ForegroundColor Yellow
    Write-Host "" -ForegroundColor Yellow
    
    # Try security-focused tests only
    Write-Host "Running Windows security tests..." -ForegroundColor Green
    
    try {
        # First rebuild in Release mode to ensure tests can run
        Write-Host "`nRebuilding in Release mode for security tests..." -ForegroundColor Yellow
        Invoke-Command "npm run build:native" "Rebuilding in Release mode"
        
        # Run Windows-specific security tests only
        Invoke-Command "node --expose-gc node_modules/jest/bin/jest.js --no-coverage --runInBand src/windows-resource-security.test.ts" "Running security tests"
        
        Write-Host "`nSecurity tests completed successfully." -ForegroundColor Green
        Write-Host "Note: JavaScript memory tests are handled by check-memory.mjs" -ForegroundColor Yellow
        Write-Host "For CRT-based leak detection, consider using:" -ForegroundColor Yellow
        Write-Host "  - Visual Leak Detector (VLD)" -ForegroundColor Yellow
        Write-Host "  - Application Verifier" -ForegroundColor Yellow
        Write-Host "  - Dr. Memory" -ForegroundColor Yellow
    }
    catch {
        Write-Host "Error running security tests: $_" -ForegroundColor Red
        exit 1
    }
}
else {
    # Run all tests with memory leak detection
    Write-Host "`nRunning all tests with memory leak detection..." -ForegroundColor Green
    
    # Note: We allow test failures here since we're primarily looking for memory leaks
    $testExitCode = 0
    try {
        Invoke-Expression "npm test"
        $testExitCode = $LASTEXITCODE
    }
    catch {
        Write-Host "Some tests failed, but continuing to check for memory leaks..." -ForegroundColor Yellow
        $testExitCode = 1
    }
}

Write-Host "`n=== Memory Leak Detection Summary ===" -ForegroundColor Cyan
Write-Host "Check the test output above for any CRT debug heap messages." -ForegroundColor White
Write-Host "Look for patterns like:" -ForegroundColor White
Write-Host "  - Detected memory leaks!" -ForegroundColor DarkGray
Write-Host "  - Dumping objects ->" -ForegroundColor DarkGray
Write-Host "  - Object dump complete." -ForegroundColor DarkGray

Write-Host "`nDebug check completed!" -ForegroundColor Green

# Exit with appropriate code
if ($testExitCode -ne 0 -and -not $SecurityTestsOnly) {
    Write-Host "Tests failed with exit code $testExitCode" -ForegroundColor Yellow
    exit $testExitCode
}