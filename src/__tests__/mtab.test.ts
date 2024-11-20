// src/__tests__/mtab.test.ts
import { formatMtab, parseMtab } from "../linux/mtab.js";

describe("mtab", () => {
  describe("parseMtab()", () => {
    it("should parse typical mtab entries correctly", () => {
      const mtabContent = `
/dev/sda1 / ext4 rw,relatime,data=ordered 0 1
/dev/sda2 /home ext4 rw,relatime,data=ordered 0 2
proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0
tmpfs /run tmpfs rw,nosuid,nodev,mode=755 0 0
nfs-server:/export /mnt/nfs nfs rw,vers=4.1 0 0
192.168.0.216:/mnt/HDD1 /media/freenas/ nfs rw,bg,soft,intr,nosuid 0 0
//cifs-server/share /mnt/cifs cifs rw,credentials=/path/to/credentials 0 0
`;

      const entries = parseMtab(mtabContent);

      expect(entries).toEqual([
        {
          fs_spec: "/dev/sda1",
          fs_file: "/",
          fs_vfstype: "ext4",
          fs_mntops: "rw,relatime,data=ordered",
          fs_freq: 0,
          fs_passno: 1,
        },
        {
          fs_spec: "/dev/sda2",
          fs_file: "/home",
          fs_vfstype: "ext4",
          fs_mntops: "rw,relatime,data=ordered",
          fs_freq: 0,
          fs_passno: 2,
        },
        {
          fs_spec: "proc",
          fs_file: "/proc",
          fs_vfstype: "proc",
          fs_mntops: "rw,nosuid,nodev,noexec,relatime",
          fs_freq: 0,
          fs_passno: 0,
        },
        {
          fs_spec: "tmpfs",
          fs_file: "/run",
          fs_vfstype: "tmpfs",
          fs_mntops: "rw,nosuid,nodev,mode=755",
          fs_freq: 0,
          fs_passno: 0,
        },
        {
          fs_file: "/mnt/nfs",
          fs_freq: 0,
          fs_mntops: "rw,vers=4.1",
          fs_passno: 0,
          fs_vfstype: "nfs",
          fs_spec: "nfs-server:/export",
          protocol: "nfs",
          remoteHost: "nfs-server",
          remoteShare: "export",
        },
        {
          fs_file: "/media/freenas",
          fs_freq: 0,
          fs_mntops: "rw,bg,soft,intr,nosuid",
          fs_passno: 0,
          fs_spec: "192.168.0.216:/mnt/HDD1",
          fs_vfstype: "nfs",
          protocol: "nfs",
          remoteHost: "192.168.0.216",
          remoteShare: "mnt/HDD1",
        },
        {
          fs_file: "/mnt/cifs",
          fs_freq: 0,
          fs_mntops: "rw,credentials=/path/to/credentials",
          fs_passno: 0,
          fs_spec: "//cifs-server/share",
          fs_vfstype: "cifs",
          protocol: "cifs",
          remoteHost: "cifs-server",
          remoteShare: "share",
        },
      ]);
    });

    it("should handle comments and empty lines", () => {
      const mtabContent = `
# This is a comment
/dev/sda1 / ext4 rw,relatime,data=ordered 0 1

# Another comment
/dev/sda2 /home ext4 rw,relatime,data=ordered 0 2

    # comment with leading spaces
  \t  # comment with leading tabs
`;

      const entries = parseMtab(mtabContent);

      expect(entries).toEqual([
        {
          fs_spec: "/dev/sda1",
          fs_file: "/",
          fs_vfstype: "ext4",
          fs_mntops: "rw,relatime,data=ordered",
          fs_freq: 0,
          fs_passno: 1,
        },
        {
          fs_spec: "/dev/sda2",
          fs_file: "/home",
          fs_vfstype: "ext4",
          fs_mntops: "rw,relatime,data=ordered",
          fs_freq: 0,
          fs_passno: 2,
        },
      ]);
    });

    it("should skip malformed lines", () => {
      const mtabContent = `
# Valid line
/dev/sda1 / ext4 rw,relatime,data=ordered 0 1
# Malformed line with only 2 fields
/dev/sda2 /home
# Another valid line
tmpfs /run tmpfs rw,nosuid,nodev,mode=755 0 0
`;

      expect(parseMtab(mtabContent)).toEqual([
        {
          fs_spec: "/dev/sda1",
          fs_file: "/",
          fs_vfstype: "ext4",
          fs_mntops: "rw,relatime,data=ordered",
          fs_freq: 0,
          fs_passno: 1,
        },
        {
          fs_spec: "tmpfs",
          fs_file: "/run",
          fs_vfstype: "tmpfs",
          fs_mntops: "rw,nosuid,nodev,mode=755",
          fs_freq: 0,
          fs_passno: 0,
        },
      ]);
    });

    it("should parse entries with escaped spaces", () => {
      const mtabContent = `
/dev/sda1 /with\\040space ext4 rw,relatime,data=ordered 0 1
/dev/sda2 /another\\040mount\\040point ext4 rw,relatime,data=ordered 0 2
`;

      expect(parseMtab(mtabContent)).toEqual([
        {
          fs_spec: "/dev/sda1",
          fs_file: "/with space",
          fs_vfstype: "ext4",
          fs_mntops: "rw,relatime,data=ordered",
          fs_freq: 0,
          fs_passno: 1,
        },
        {
          fs_spec: "/dev/sda2",
          fs_file: "/another mount point",
          fs_vfstype: "ext4",
          fs_mntops: "rw,relatime,data=ordered",
          fs_freq: 0,
          fs_passno: 2,
        },
      ]);
    });

    it("should parse entries with escape sequences", () => {
      const mtabContent = `
/dev/sda1 /weird\\011mount\\012point ext4 rw,relatime,data=ordered 0 1
`;

      const entries = parseMtab(mtabContent);
      expect(entries).toEqual([
        {
          fs_spec: "/dev/sda1",
          fs_file: "/weird\tmount\npoint",
          fs_vfstype: "ext4",
          fs_mntops: "rw,relatime,data=ordered",
          fs_freq: 0,
          fs_passno: 1,
        },
      ]);
    });

    it("should handle edge cases with missing fields", () => {
      const mtabContent = `
# Missing fs_vfstype
/dev/sda1 / ext4 opts 1
# Missing fs_mntops
/dev/sda2 /home ext4
# Valid line
tmpfs /run tmpfs rw,nosuid,nodev,mode=755 0 0
# missing vfstype
/dev/sda3 /var/log/
`;

      const entries = parseMtab(mtabContent);
      expect(entries).toEqual([
        {
          fs_file: "/",
          fs_freq: 1,
          fs_mntops: "opts",
          fs_passno: undefined,
          fs_spec: "/dev/sda1",
          fs_vfstype: "ext4",
        },
        {
          fs_file: "/home",
          fs_freq: undefined,
          fs_mntops: undefined,
          fs_passno: undefined,
          fs_spec: "/dev/sda2",
          fs_vfstype: "ext4",
        },
        {
          fs_file: "/run",
          fs_freq: 0,
          fs_mntops: "rw,nosuid,nodev,mode=755",
          fs_passno: 0,
          fs_spec: "tmpfs",
          fs_vfstype: "tmpfs",
        },
      ]);
    });

    it("should parse entries with extra fields", () => {
      const mtabContent = `
/dev/sda1 / ext4 rw,relatime,data=ordered 0 1 extra_field
`;

      const entries = parseMtab(mtabContent);

      expect(entries.length).toBe(1);

      expect(entries[0]).toEqual({
        fs_spec: "/dev/sda1",
        fs_file: "/",
        fs_vfstype: "ext4",
        fs_mntops: "rw,relatime,data=ordered",
        fs_freq: 0,
        fs_passno: 1,
      });
    });

    it("should normalize mount points by removing trailing slashes", () => {
      const mtabContent = `
/dev/sda1 / ext4 rw,relatime,data=ordered 0 1
/dev/sda2 /home/ ext4 rw,relatime,data=ordered 0 2
/dev/sda3 /var/log/ ext4 rw,relatime,data=ordered 0 2
`;

      const entries = parseMtab(mtabContent);

      expect(entries.length).toBe(3);

      expect(entries[0]?.fs_file).toBe("/");
      expect(entries[1]?.fs_file).toBe("/home");
      expect(entries[2]?.fs_file).toBe("/var/log");
    });
  });

  describe("formatMtab()", () => {
    it("should format mount entries back into mtab file content", () => {
      const entries = [
        {
          fs_spec: "/dev/sda1",
          fs_file: "/",
          fs_vfstype: "ext4",
          fs_mntops: "rw,relatime,data=ordered",
          fs_freq: 0,
          fs_passno: 1,
        },
        {
          fs_spec: "/dev/sda2",
          fs_file: "/home",
          fs_vfstype: "ext4",
          fs_mntops: "rw,relatime,data=ordered",
          fs_freq: 0,
          fs_passno: 2,
        },
        {
          fs_file: "/media/freenas",
          fs_freq: 0,
          fs_mntops: "rw,bg,soft,intr,nosuid",
          fs_passno: 0,
          fs_spec: "192.168.0.216:/mnt/HDD1",
          fs_vfstype: "nfs",
        },
        {
          fs_file: "/mnt/cifs",
          fs_freq: 0,
          fs_mntops: "rw,credentials=/path/to/credentials",
          fs_passno: 0,
          fs_spec: "//cifs-server/share",
          fs_vfstype: "cifs",
        },
      ];

      const mtabContent = formatMtab(entries);

      expect(mtabContent).toEqual(
        `/dev/sda1	/	ext4	rw,relatime,data=ordered	0	1
/dev/sda2	/home	ext4	rw,relatime,data=ordered	0	2
192.168.0.216:/mnt/HDD1	/media/freenas	nfs	rw,bg,soft,intr,nosuid	0	0
//cifs-server/share	/mnt/cifs	cifs	rw,credentials=/path/to/credentials	0	0`.trim(),
      );
    });
  });
});
