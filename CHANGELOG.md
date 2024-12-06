# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!--
Added for new features.
Changed for changes in existing functionality.
Deprecated for soon-to-be removed features.
Removed for now removed features.
Fixed for any bug fixes.
Security in case of vulnerabilities. 
-->

## [0.0.1] - to be released

First release! Everything is a new feature!

The 1.0.0 release will happen after some integration testing with the native
library payloads, but the API should be stable after the first release.

## TODO

- see if macOS has a native, not expensive "health status" for both
  getVolumeMountPoints and getVolumeMetadata

- try to add `syscall` (and `errno`) to all native exceptions, like:

> require("fs").readdirSync("/home/mrm/.bashrc")
Uncaught Error: ENOTDIR: not a directory, scandir '/home/mrm/.bashrc'
    at Object.readdirSync (node:fs:1506:26) {
  errno: -20,
  code: 'ENOTDIR',
  syscall: 'scandir',
  path: '/home/mrm/.bashrc'
}
