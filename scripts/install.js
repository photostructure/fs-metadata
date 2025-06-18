#!/usr/bin/env node

/**
 * Custom install script that handles Windows architecture defines
 * when node-gyp-build needs to compile from source
 */

const { spawn } = require('child_process');
const { platform, arch } = require('os');

// If in CI and on Windows, set architecture defines
if (process.env.CI && platform() === 'win32') {
  const currentArch = arch();
  
  // Set architecture-specific defines for Windows
  if (currentArch === 'x64') {
    process.env.CL = '/D_M_X64 /D_WIN64 /D_AMD64_';
  } else if (currentArch === 'arm64') {
    process.env.CL = '/D_M_ARM64 /D_WIN64';
  }
  
  console.log(`Windows CI detected: arch=${currentArch}, CL=${process.env.CL}`);
}

// Run node-gyp-build
const child = spawn('npx', ['node-gyp-build'], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

child.on('error', (error) => {
  console.error('Failed to run node-gyp-build:', error);
  process.exit(1);
});

child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`node-gyp-build exited with code ${code}`);
    process.exit(code || 1);
  }
});