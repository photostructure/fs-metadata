// Test-only dylib: stop one real native call until the parent releases fd 4.
// fd 3 reports readiness. Never linked into the published addon.
#include <DiskArbitration/DiskArbitration.h>
#include <atomic>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <dirent.h>
#include <poll.h>
#include <unistd.h>

namespace {
std::atomic<bool> blocked{false};

void BlockOnce(const char *operation) {
  const char *target = std::getenv("FSMETA_TEST_BLOCK");
  if (!target || std::strcmp(target, operation) != 0 ||
      blocked.exchange(true)) {
    return;
  }
  if (write(3, "B", 1) != 1) {
    _exit(90);
  }
  char byte;
  for (;;) {
    if (read(4, &byte, 1) == 1) {
      break;
    }
    if (errno != EINTR && errno != EAGAIN) {
      _exit(91);
    }
    struct pollfd fd = {4, POLLIN, 0};
    poll(&fd, 1, -1);
  }
  if (write(3, "R", 1) != 1) {
    _exit(92);
  }
}

// The interposed Create function transfers its retained result to the caller.
DASessionRef TestSession(CFAllocatorRef allocator) CF_RETURNS_RETAINED;
DASessionRef TestSession(CFAllocatorRef allocator) {
  BlockOnce("da");
  return DASessionCreate(allocator);
}

io_service_t TestMedia(DADiskRef disk) {
  BlockOnce("iokit");
  return DADiskCopyIOMedia(disk);
}

char *TestRealpath(const char *path, char *resolved) {
  if (std::strcmp(path, "/") == 0)
    BlockOnce("path");
  return realpath(path, resolved);
}

DIR *TestOpendir(const char *path) {
  if (std::strcmp(path, "/") == 0)
    BlockOnce("directory");
  return opendir(path);
}

// dyld does not interpose calls made by the interposing image itself, so the
// calls above reach the originals without dlsym or recursive interception.
__attribute__((used, section("__DATA,__interpose"))) const struct {
  const void *replacement;
  const void *original;
} interposers[] = {
    {reinterpret_cast<const void *>(TestSession),
     reinterpret_cast<const void *>(DASessionCreate)},
    {reinterpret_cast<const void *>(TestMedia),
     reinterpret_cast<const void *>(DADiskCopyIOMedia)},
    {reinterpret_cast<const void *>(TestRealpath),
     reinterpret_cast<const void *>(realpath)},
    {reinterpret_cast<const void *>(TestOpendir),
     reinterpret_cast<const void *>(opendir)},
};
} // namespace
