#!/bin/bash
# Build native module with portable GLIBC compatibility
# Uses Debian 11 Bullseye (GLIBC 2.31) to balance compatibility and modern toolchain
#
# GLIBC versions in official Node.js Docker images:
# - node:*-buster:   GLIBC 2.28 (Debian 10) - Python 3.7, GCC 8.3 (too old)
# - node:*-bullseye: GLIBC 2.31 (Debian 11) - Python 3.9, GCC 10.2 (good balance)
# - node:*-bookworm: GLIBC 2.36 (Debian 12) - Python 3.11, GCC 12.2
# - node:* (default): GLIBC 2.36 (Debian 12 Bookworm)
# - node:*-alpine:   musl libc (not GLIBC)
#
# Other common environments:
# - Ubuntu 20.04 LTS: GLIBC 2.31 (matches our target)
# - Ubuntu 22.04 LTS: GLIBC 2.35
# - CentOS 7:         GLIBC 2.17 (EOL, not supported)
# - Amazon Linux 2:   GLIBC 2.26 (older, but should work)
#
# By targeting GLIBC 2.31, we support Ubuntu 20.04 LTS and newer,
# while having a modern enough toolchain for Node.js requirements.

set -euo pipefail

# Allow architecture override (for CI cross-compilation)
TARGET_ARCH="${TARGET_ARCH:-}"

# If no target architecture specified, detect from host
if [ -z "$TARGET_ARCH" ]; then
  ARCH=$(uname -m)
  if [ "$ARCH" = "x86_64" ]; then
    TARGET_ARCH="x64"
  elif [ "$ARCH" = "aarch64" ]; then
    TARGET_ARCH="arm64"
  else
    echo "Unsupported architecture: $ARCH"
    exit 1
  fi
fi

# Map to Docker platform architecture
if [ "$TARGET_ARCH" = "x64" ]; then
  DOCKER_ARCH="amd64"
elif [ "$TARGET_ARCH" = "arm64" ]; then
  DOCKER_ARCH="arm64"
else
  echo "Unsupported target architecture: $TARGET_ARCH"
  exit 1
fi

# Determine which build command to use
BUILD_CMD="${BUILD_CMD:-npm run build:native}"

# Check if we're already in a compatible environment
if [ -f /etc/os-release ]; then
  . /etc/os-release
  if [[ "${ID:-}" == "debian" && "${VERSION_ID:-}" == "11" ]]; then
    echo "Already in Debian 11 Bullseye, building directly..."
    $BUILD_CMD
    exit 0
  fi
fi

# Check if Docker is available
if ! command -v docker &> /dev/null; then
  echo "Docker not found, falling back to local build"
  echo "Warning: Binary may not be portable due to GLIBC version"
  $BUILD_CMD
  exit 0
fi

echo "Building native module in Debian 11 Bullseye container for GLIBC 2.31 compatibility..."
echo "Target architecture: $TARGET_ARCH (Docker platform: linux/$DOCKER_ARCH)"

# Create a container, build inside it, then copy artifacts out
CONTAINER_NAME="fs-metadata-build-$$"

# Start container in background
docker run -d \
  --name "$CONTAINER_NAME" \
  --platform "linux/$DOCKER_ARCH" \
  node:20-bullseye \
  sleep 3600

# Copy project files into container
docker cp . "$CONTAINER_NAME:/tmp/project"

# Run build inside container
# Debian 11 has Python 3.9 and GCC 10.2 which support our requirements
docker exec "$CONTAINER_NAME" sh -c "
  cd /tmp/project && \
  apt-get update -qq && \
  apt-get install -y -qq build-essential python3 libglib2.0-dev libblkid-dev uuid-dev git && \
  # Verify versions
  echo 'Python version:' && python3 --version && \
  echo 'GCC version:' && gcc --version | head -1 && \
  # Build the project
  npm ci --ignore-scripts && \
  $BUILD_CMD
"

# Copy artifacts back
docker cp "$CONTAINER_NAME:/tmp/project/prebuilds" . 2>/dev/null || true
docker cp "$CONTAINER_NAME:/tmp/project/build" . 2>/dev/null || true
docker cp "$CONTAINER_NAME:/tmp/project/config.gypi" . 2>/dev/null || true

# Fix ownership (docker cp preserves container's root ownership)
if [ -d prebuilds ]; then
  chown -R "$(id -u):$(id -g)" prebuilds
fi
if [ -d build ]; then
  chown -R "$(id -u):$(id -g)" build
fi
if [ -f config.gypi ]; then
  chown "$(id -u):$(id -g)" config.gypi
fi

# Clean up container
docker rm -f "$CONTAINER_NAME" >/dev/null

echo "Portable build complete!"