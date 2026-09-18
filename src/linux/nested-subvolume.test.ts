// src/linux/nested-subvolume.test.ts
//
// A btrfs subvolume nested inside a mounted filesystem has its own anonymous
// st_dev but NO entry in the mount table. Resolution by device id therefore
// matches nothing, and the containing mount has to be found by path ancestry
// instead — but only when there is evidence the path really is inside a btrfs
// subvolume, so every other "no mount point found" stays a loud failure.
//
// These tests inject stat()/statfs(), so they run on any Linux host (CI is
// ext4/overlay and has no btrfs). The host-conditional counterparts that
// exercise the real ioctl live in ./btrfs-subvolume.test.ts.

import type { StatsFs } from "node:fs";
import type { realpath } from "node:fs/promises";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { statAsync, statfsAsync } from "../fs";
import { optionsWithDefaults } from "../options";
import { describePlatform } from "../test-utils/platform";
import type { MountPoint } from "../types/mount_point";
import type { NativeBindingsFn } from "../types/native_bindings";
import type { Options } from "../types/options";
import {
  findMountPointByDeviceId,
  getVolumeMetadataForPathImpl,
} from "../volume_metadata";
import { getContainingMountEntry } from "./mount_points";
import {
  BtrfsSubvolumeRootInode,
  BtrfsSuperMagic,
  findSubvolumeRoot,
} from "./subvolume";

const Ext4SuperMagic = 0xef53;

/** The mount, its nested subvolumes, and the anomalies that must NOT resolve. */
const MOUNT = "/mnt/12tb";
const NESTED = "/mnt/12tb/backup-2026-05-02";
const NESTED_CHILD = "/mnt/12tb/backup-2026-05-02/photos";
const NESTED_FILE = "/mnt/12tb/backup-2026-05-02/photos/img.jpg";
const PLAIN_DIR = "/mnt/12tb/migration-2026-07-24";
const MOUNT_DEV = 110;
const NESTED_DEV = 113;

interface FakeStat {
  dev: number;
  ino: number;
  dir?: boolean;
}

/** Every path this fixture knows about, keyed by absolute path. */
const TREE: Record<string, FakeStat> = {
  "/": { dev: 2049, ino: 2 },
  "/mnt": { dev: 2049, ino: 500 },
  [MOUNT]: { dev: MOUNT_DEV, ino: BtrfsSubvolumeRootInode },
  [NESTED]: { dev: NESTED_DEV, ino: BtrfsSubvolumeRootInode },
  [NESTED_CHILD]: { dev: NESTED_DEV, ino: 9001 },
  [NESTED_FILE]: { dev: NESTED_DEV, ino: 9002, dir: false },
  [PLAIN_DIR]: { dev: MOUNT_DEV, ino: 9107 },
};

function fakeStat(tree: Record<string, FakeStat> = TREE): typeof statAsync {
  return ((path: string) => {
    const s = tree[String(path)];
    return s == null
      ? Promise.reject(new Error("ENOENT: " + String(path)))
      : Promise.resolve({
          dev: s.dev,
          ino: s.ino,
          isDirectory: () => s.dir !== false,
        });
  }) as unknown as typeof statAsync;
}

function fakeStatfs(typeByPath: Record<string, number>): typeof statfsAsync {
  return ((path: string) => {
    const type = typeByPath[String(path)];
    return type == null
      ? Promise.reject(new Error("ENOENT: " + String(path)))
      : Promise.resolve({ type } as StatsFs);
  }) as unknown as typeof statfsAsync;
}

describePlatform("linux")("nested btrfs subvolumes", () => {
  describe("findSubvolumeRoot()", () => {
    it("returns the subvolume root for a nested subvolume", async () => {
      await expect(findSubvolumeRoot(NESTED, MOUNT, fakeStat())).resolves.toBe(
        NESTED,
      );
    });

    it("walks up to the subvolume root from a path inside it", async () => {
      await expect(
        findSubvolumeRoot(NESTED_CHILD, MOUNT, fakeStat()),
      ).resolves.toBe(NESTED);
    });

    it("starts at the containing directory for a file", async () => {
      // The ioctl needs a directory fd, and a file's identity is its
      // directory's.
      await expect(
        findSubvolumeRoot(NESTED_FILE, MOUNT, fakeStat()),
      ).resolves.toBe(NESTED);
    });

    it("returns the mount point for a plain directory under it", async () => {
      // A plain directory belongs to the subvolume the mount exposes, whose
      // root IS the mount point.
      await expect(
        findSubvolumeRoot(PLAIN_DIR, MOUNT, fakeStat()),
      ).resolves.toBe(MOUNT);
    });

    it("returns the mount point itself", async () => {
      await expect(findSubvolumeRoot(MOUNT, MOUNT, fakeStat())).resolves.toBe(
        MOUNT,
      );
    });

    it("stops at the mount point and never walks above it", async () => {
      // /mnt and / are in the fixture; reaching either would mean the walk
      // escaped the mount. A bind-mounted subdirectory is not a subvolume root
      // (st_ino != 256), so there is nothing to report.
      const bindMount = "/mnt/bound";
      const tree = {
        ...TREE,
        [bindMount]: { dev: NESTED_DEV, ino: 9001 },
        "/mnt/bound/photos": { dev: NESTED_DEV, ino: 9003 },
      };
      await expect(
        findSubvolumeRoot("/mnt/bound/photos", bindMount, fakeStat(tree)),
      ).resolves.toBeUndefined();
    });

    it("returns undefined for a file bind mount", async () => {
      // The mount point is the file itself, so its directory is on the other
      // side of the mount boundary.
      const tree = {
        ...TREE,
        "/etc/hosts": { dev: 77, ino: 4242, dir: false },
        "/etc": { dev: 2049, ino: 600 },
      };
      await expect(
        findSubvolumeRoot("/etc/hosts", "/etc/hosts", fakeStat(tree)),
      ).resolves.toBeUndefined();
    });

    it("returns the INNERMOST subvolume root, for a directory and a file", async () => {
      // A subvolume nested inside a nested subvolume: identity belongs to the
      // innermost one, so the walk must stop at the first st_ino 256 it meets
      // rather than continuing to the outer subvolume or the mount.
      const INNER = `${NESTED}/inner`;
      const INNER_DEV = 999;
      const tree: Record<string, FakeStat> = {
        ...TREE,
        [INNER]: { dev: INNER_DEV, ino: BtrfsSubvolumeRootInode },
        [`${INNER}/photos`]: { dev: INNER_DEV, ino: 4001 },
        [`${INNER}/photos/img.jpg`]: { dev: INNER_DEV, ino: 4002, dir: false },
      };
      await expect(
        findSubvolumeRoot(`${INNER}/photos`, MOUNT, fakeStat(tree)),
      ).resolves.toBe(INNER);
      await expect(
        findSubvolumeRoot(`${INNER}/photos/img.jpg`, MOUNT, fakeStat(tree)),
      ).resolves.toBe(INNER);
    });

    it("returns undefined when the path is not under the mount point", async () => {
      await expect(
        findSubvolumeRoot(PLAIN_DIR, "/somewhere/else", fakeStat()),
      ).resolves.toBeUndefined();
    });
  });

  describe("findMountPointByDeviceId() nested-subvolume fallback", () => {
    const nativeFn = (() => {
      throw new Error("native bindings must not be reached");
    }) as unknown as NativeBindingsFn;

    function options(mountPoints: MountPoint[]): Options {
      return optionsWithDefaults({ mountPoints });
    }

    const btrfsMount: MountPoint = { mountPoint: MOUNT, fstype: "btrfs" };
    const rootMount: MountPoint = { mountPoint: "/", fstype: "ext4" };
    const nestedStat = {
      dev: NESTED_DEV,
      isDirectory: () => true,
    } as unknown as Awaited<ReturnType<typeof statAsync>>;

    it("resolves to the containing btrfs mount when no device matches", async () => {
      await expect(
        findMountPointByDeviceId(
          NESTED,
          nestedStat,
          options([rootMount, btrfsMount]),
          nativeFn,
          fakeStat(),
          undefined,
          fakeStatfs({ [NESTED]: BtrfsSuperMagic }),
        ),
      ).resolves.toBe(MOUNT);
    });

    it("prefers a real device match over the fallback", async () => {
      // The fallback is last-resort only: a mount whose device actually matches
      // is the answer, even when a btrfs ancestor is also present.
      await expect(
        findMountPointByDeviceId(
          PLAIN_DIR,
          { dev: MOUNT_DEV } as unknown as Awaited<
            ReturnType<typeof statAsync>
          >,
          options([rootMount, btrfsMount]),
          nativeFn,
          fakeStat(),
          undefined,
          fakeStatfs({ [PLAIN_DIR]: BtrfsSuperMagic }),
        ),
      ).resolves.toBe(MOUNT);
    });

    it("still throws when the containing mount is not btrfs", async () => {
      // An unmatched device under a non-btrfs mount is a genuine anomaly, and
      // must stay a loud failure rather than become a plausible wrong answer.
      await expect(
        findMountPointByDeviceId(
          NESTED,
          nestedStat,
          options([rootMount, { mountPoint: MOUNT, fstype: "ext4" }]),
          nativeFn,
          fakeStat(),
          undefined,
          fakeStatfs({ [NESTED]: Ext4SuperMagic }),
        ),
      ).rejects.toThrow(/No mount point found/);
    });

    it("still throws when statfs() says the target is not on btrfs", async () => {
      await expect(
        findMountPointByDeviceId(
          NESTED,
          nestedStat,
          options([rootMount, btrfsMount]),
          nativeFn,
          fakeStat(),
          undefined,
          fakeStatfs({ [NESTED]: Ext4SuperMagic }),
        ),
      ).rejects.toThrow(/No mount point found/);
    });

    it("still throws when statfs() fails", async () => {
      await expect(
        findMountPointByDeviceId(
          NESTED,
          nestedStat,
          options([rootMount, btrfsMount]),
          nativeFn,
          fakeStat(),
          undefined,
          fakeStatfs({}),
        ),
      ).rejects.toThrow(/No mount point found/);
    });

    it("outranks a non-ancestor mount that shares the target's device", async () => {
      // A bind mount of a file INSIDE a nested subvolume carries that
      // subvolume's anonymous device, so the device-only fallback matches it
      // and returns a path with no relationship to the target. An ancestor
      // match — which is what the btrfs resolution is — must win first.
      const fileBind = "/var/tmp/file-bind-target.txt";
      await expect(
        findMountPointByDeviceId(
          NESTED,
          nestedStat,
          options([
            rootMount,
            btrfsMount,
            { mountPoint: fileBind, fstype: "btrfs" },
          ]),
          nativeFn,
          fakeStat({ ...TREE, [fileBind]: { dev: NESTED_DEV, ino: 4242 } }),
          undefined,
          fakeStatfs({ [NESTED]: BtrfsSuperMagic }),
        ),
      ).resolves.toBe(MOUNT);
    });

    it("prefers a deeper btrfs mount over a shallower device match", async () => {
      // The standard btrfs snapshot-management layout: the `@` subvolume is
      // mounted at /, and the same filesystem's top-level tree at /mnt/all. A
      // path under /mnt/all/@ is IN @, so its anonymous device equals /'s —
      // and / device-matches before the deeper /mnt/all is considered. The
      // device names the subvolume, not the mount, so ancestry has to win:
      // otherwise subvolumeRoot comes back as / and relative() yields
      // "mnt/all/@/photos" instead of "photos".
      const AT_DEV = 300;
      const TOP_DEV = 301;
      const tree: Record<string, FakeStat> = {
        "/": { dev: AT_DEV, ino: BtrfsSubvolumeRootInode },
        "/mnt": { dev: AT_DEV, ino: 900 },
        "/mnt/all": { dev: TOP_DEV, ino: BtrfsSubvolumeRootInode },
        "/mnt/all/@": { dev: AT_DEV, ino: BtrfsSubvolumeRootInode },
        "/mnt/all/@/photos": { dev: AT_DEV, ino: 901 },
      };
      await expect(
        findMountPointByDeviceId(
          "/mnt/all/@/photos",
          { dev: AT_DEV, isDirectory: () => true } as unknown as Awaited<
            ReturnType<typeof statAsync>
          >,
          options([
            { mountPoint: "/", fstype: "btrfs" },
            { mountPoint: "/mnt/all", fstype: "btrfs" },
          ]),
          nativeFn,
          fakeStat(tree),
          undefined,
          fakeStatfs({ "/mnt/all/@/photos": BtrfsSuperMagic }),
        ),
      ).resolves.toBe("/mnt/all");
    });

    it("keeps the device match when no btrfs ancestor is deeper", async () => {
      // The common case must not pay for the above: an exact device match that
      // is already the deepest btrfs ancestor is returned as-is.
      await expect(
        findMountPointByDeviceId(
          PLAIN_DIR,
          { dev: MOUNT_DEV } as unknown as Awaited<
            ReturnType<typeof statAsync>
          >,
          options([rootMount, btrfsMount]),
          nativeFn,
          fakeStat(),
          undefined,
          // statfs must not even be consulted here.
          fakeStatfs({}),
        ),
      ).resolves.toBe(MOUNT);
    });

    it("picks the longest btrfs ancestor", async () => {
      await expect(
        findMountPointByDeviceId(
          NESTED,
          nestedStat,
          options([
            { mountPoint: "/", fstype: "btrfs" },
            { mountPoint: "/mnt", fstype: "btrfs" },
            btrfsMount,
          ]),
          nativeFn,
          fakeStat(),
          undefined,
          fakeStatfs({ [NESTED]: BtrfsSuperMagic }),
        ),
      ).resolves.toBe(MOUNT);
    });
  });
});

describePlatform("linux")("getContainingMountEntry()", () => {
  let dir: string;
  let table: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "fs-metadata-containing-"));
    table = join(dir, "mounts");
    await writeFile(
      table,
      [
        "/dev/sda1 / ext4 rw 0 0",
        "/dev/sdb1 /mnt/12tb btrfs rw,subvolid=5,subvol=/ 0 0",
        // A deeper mount, and a stacked pair on one path: last entry wins.
        "/dev/sdc1 /mnt/12tb/inner btrfs rw,subvolid=5,subvol=/ 0 0",
        "systemd-1 /mnt/auto autofs rw 0 0",
        "/dev/sdd1 /mnt/auto btrfs rw,subvolid=5,subvol=/ 0 0",
      ].join("\n"),
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const opts = () => ({ linuxMountTablePaths: [table] });

  it("returns the deepest containing entry", async () => {
    const entry = await getContainingMountEntry(
      "/mnt/12tb/inner/nested/photos",
      opts(),
    );
    expect(entry?.fs_file).toBe("/mnt/12tb/inner");
    expect(entry?.fs_vfstype).toBe("btrfs");
    expect(entry?.fs_spec).toBe("/dev/sdc1");
  });

  it("does not mistake a sibling prefix for an ancestor", async () => {
    // "/mnt/12tb-other" must not match the "/mnt/12tb" entry.
    const entry = await getContainingMountEntry("/mnt/12tb-other/x", opts());
    expect(entry?.fs_file).toBe("/");
  });

  it("returns the entry stacked last on a path", async () => {
    // A systemd automount keeps its autofs trigger and the real filesystem is
    // mounted over it; the last entry describes what a caller reaches.
    const entry = await getContainingMountEntry("/mnt/auto/sub", opts());
    expect(entry?.fs_vfstype).toBe("btrfs");
    expect(entry?.fs_spec).toBe("/dev/sdd1");
  });

  it("returns the entry for the mount point itself", async () => {
    expect((await getContainingMountEntry("/mnt/12tb", opts()))?.fs_file).toBe(
      "/mnt/12tb",
    );
  });

  it("returns undefined when the table cannot be read", async () => {
    await expect(
      getContainingMountEntry("/mnt/12tb/x", {
        linuxMountTablePaths: [join(dir, "does-not-exist")],
      }),
    ).resolves.toBeUndefined();
  });
});

// Entry-point coverage with every dependency injected: a real temp directory
// tree (so realpath(), opendir(), and the health probe work), a fixture mount
// table, fake stat/statfs that make the tree look like btrfs, and a fake native
// worker that records the path it was asked to probe. This pins the WIRING —
// which path the ioctl is run against, and which mount is reported — on hosts
// with no btrfs, which is every CI runner.
describePlatform("linux")("nested subvolume metadata, end to end", () => {
  let root: string;
  let mount: string;
  let nestedSubvol: string;
  let table: string;
  let probed: string[] = [];

  /** The fixture paths are already canonical, so realpath is identity. */
  const identityRealpath = ((path: string) =>
    Promise.resolve(path)) as unknown as typeof realpath;

  const NATIVE_UUID = "11111111-2222-3333-4444-555555555555";
  const E2E_MOUNT_DEV = 40;
  const E2E_NESTED_DEV = 41;

  /** Records what the native worker was asked to probe. */
  const nativeFn = (() =>
    Promise.resolve({
      getVolumeMetadata: (o: { mountPoint: string }) => {
        probed.push(o.mountPoint);
        return Promise.resolve({
          size: 100,
          used: 10,
          available: 90,
          status: "healthy",
          isReadOnly: false,
          subvolumeUuid: NATIVE_UUID,
          subvolid: 256,
        });
      },
    })) as unknown as NativeBindingsFn;

  function fakes(tree: Record<string, FakeStat>) {
    return {
      stat: fakeStat(tree),
      statfs: fakeStatfs(
        Object.fromEntries(Object.keys(tree).map((k) => [k, BtrfsSuperMagic])),
      ),
    };
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "fs-metadata-e2e-"));
    mount = join(root, "mount");
    nestedSubvol = join(mount, "nested");
    table = join(root, "mounts");
    await mkdir(join(nestedSubvol, "photos"), { recursive: true });
    await mkdir(join(mount, "plain"), { recursive: true });
    await writeFile(
      table,
      `/dev/sdb1 ${mount} btrfs rw,subvolid=5,subvol=/ 0 0\n`,
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    probed = [];
  });

  const tree = (): Record<string, FakeStat> => ({
    [root]: { dev: 1, ino: 2 },
    [mount]: { dev: E2E_MOUNT_DEV, ino: BtrfsSubvolumeRootInode },
    [nestedSubvol]: { dev: E2E_NESTED_DEV, ino: BtrfsSubvolumeRootInode },
    [join(nestedSubvol, "photos")]: { dev: E2E_NESTED_DEV, ino: 700 },
    [join(mount, "plain")]: { dev: E2E_MOUNT_DEV, ino: 701 },
  });

  const opts = () => optionsWithDefaults({ linuxMountTablePaths: [table] });

  it("probes the nested path and reports the containing mount", async () => {
    const { stat, statfs } = fakes(tree());
    const md = await getVolumeMetadataForPathImpl(
      join(nestedSubvol, "photos"),
      opts(),
      nativeFn,
      identityRealpath,
      stat,
      statfs,
    );
    // The ioctl must run inside the nested subvolume, not at the mount.
    expect(probed).toEqual([join(nestedSubvol, "photos")]);
    expect(md.mountPoint).toBe(mount);
    expect(md.subvolumeRoot).toBe(nestedSubvol);
    expect(md.subvolumeUuid).toBe(NATIVE_UUID);
    // The mount's own subvol=/ and subvolid=5 describe a different subvolume.
    expect(md.subvol).toBeUndefined();
    expect(md.subvolid).toBe(256);
  });

  it("reports the containing mount's own identity when asked for it", async () => {
    const { stat, statfs } = fakes(tree());
    const md = await getVolumeMetadataForPathImpl(
      mount,
      opts(),
      nativeFn,
      identityRealpath,
      stat,
      statfs,
    );
    expect(probed).toEqual([mount]);
    expect(md.mountPoint).toBe(mount);
    expect(md.subvolumeRoot).toBe(mount);
    // Here the mount option tier applies: this IS the subvolume it exposes.
    expect(md.subvol).toBe("/");
    expect(md.subvolid).toBe(5);
  });

  it("gives a bind-mounted subdirectory an identity but no subvolumeRoot", async () => {
    // The mount point is a subdirectory of a subvolume (st_ino != 256), so no
    // path under it is that subvolume's root: subvolumeUuid is still correct,
    // and no subvolume-relative coordinate can be formed.
    const bindTable = join(root, "mounts-bind");
    await writeFile(
      bindTable,
      `/dev/sdb1 ${mount} btrfs rw,subvolid=256,subvol=/nested 0 0\n`,
    );
    const { stat, statfs } = fakes({
      ...tree(),
      [mount]: { dev: E2E_NESTED_DEV, ino: 702 },
    });
    const md = await getVolumeMetadataForPathImpl(
      join(mount, "plain"),
      optionsWithDefaults({ linuxMountTablePaths: [bindTable] }),
      nativeFn,
      identityRealpath,
      stat,
      statfs,
    );
    expect(md.mountPoint).toBe(mount);
    expect(md.subvolumeRoot).toBeUndefined();
    expect(md.subvolumeUuid).toBe(NATIVE_UUID);
  });
});
