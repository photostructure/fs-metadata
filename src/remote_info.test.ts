// src/remote_info.test.ts

import {
  extractRemoteInfo,
  isRemoteFsType,
  isRemoteInfo,
  normalizeFsType,
  parseURL,
} from "./remote_info";

describe("remote_info tests", () => {
  describe("normalizeFsType", () => {
    it("should convert to lowercase", () => {
      expect(normalizeFsType("HTTP")).toBe("http");
      expect(normalizeFsType("NFS")).toBe("nfs");
      expect(normalizeFsType("CIFS")).toBe("cifs");
    });

    it("should remove trailing colon", () => {
      expect(normalizeFsType("HTTP:")).toBe("http");
      expect(normalizeFsType("ftp:")).toBe("ftp");
      expect(normalizeFsType("smb:")).toBe("smb");
    });

    it("should handle empty and null input", () => {
      expect(normalizeFsType("")).toBe("");
      expect(normalizeFsType(null as unknown as string)).toBe("");
      expect(normalizeFsType(undefined as unknown as string)).toBe("");
    });

    it("should pass through non-aliased types unchanged", () => {
      expect(normalizeFsType("ext4")).toBe("ext4");
      expect(normalizeFsType("btrfs")).toBe("btrfs");
      expect(normalizeFsType("xfs")).toBe("xfs");
    });

    describe("FS_TYPE_ALIASES", () => {
      it("should normalize NFS variants to nfs", () => {
        expect(normalizeFsType("nfs")).toBe("nfs");
        expect(normalizeFsType("nfs1")).toBe("nfs");
        expect(normalizeFsType("nfs2")).toBe("nfs");
        expect(normalizeFsType("nfs3")).toBe("nfs");
        expect(normalizeFsType("NFS3")).toBe("nfs");
      });

      it("should normalize sshfs variants to sshfs", () => {
        expect(normalizeFsType("sshfs")).toBe("sshfs");
        expect(normalizeFsType("fuse.sshfs")).toBe("sshfs");
        expect(normalizeFsType("sshfs.fuse")).toBe("sshfs");
        expect(normalizeFsType("FUSE.SSHFS")).toBe("sshfs");
      });

      it("should normalize WebDAV variants to webdav", () => {
        expect(normalizeFsType("webdav")).toBe("webdav");
        expect(normalizeFsType("davfs")).toBe("webdav");
        expect(normalizeFsType("davfs2")).toBe("webdav");
        expect(normalizeFsType("DAVFS2")).toBe("webdav");
      });

      it("should normalize cifs.smb to cifs", () => {
        expect(normalizeFsType("cifs")).toBe("cifs");
        expect(normalizeFsType("cifs.smb")).toBe("cifs");
        expect(normalizeFsType("CIFS.SMB")).toBe("cifs");
      });

      it("should normalize Ceph variants to ceph", () => {
        expect(normalizeFsType("ceph")).toBe("ceph");
        expect(normalizeFsType("cephfs")).toBe("ceph");
        expect(normalizeFsType("fuse.ceph")).toBe("ceph");
        expect(normalizeFsType("fuse.cephfs")).toBe("ceph");
        expect(normalizeFsType("rbd")).toBe("ceph");
        expect(normalizeFsType("RBD")).toBe("ceph");
      });

      it("should normalize fuse.glusterfs to glusterfs", () => {
        expect(normalizeFsType("glusterfs")).toBe("glusterfs");
        expect(normalizeFsType("fuse.glusterfs")).toBe("glusterfs");
        expect(normalizeFsType("FUSE.GLUSTERFS")).toBe("glusterfs");
      });
    });
  });

  describe("isRemoteInfo", () => {
    it("should return false for non-objects", () => {
      expect(isRemoteInfo(null)).toBe(false);
      expect(isRemoteInfo(undefined)).toBe(false);
      expect(isRemoteInfo("string")).toBe(false);
      expect(isRemoteInfo(123)).toBe(false);
      expect(isRemoteInfo([])).toBe(false);
    });

    it("should return false for objects missing remoteHost", () => {
      expect(isRemoteInfo({ remoteShare: "share" })).toBe(false);
      expect(isRemoteInfo({ remoteHost: "", remoteShare: "share" })).toBe(
        false,
      );
      expect(isRemoteInfo({ remoteHost: "  ", remoteShare: "share" })).toBe(
        false,
      );
    });

    it("should return false for objects missing remoteShare", () => {
      expect(isRemoteInfo({ remoteHost: "host" })).toBe(false);
      expect(isRemoteInfo({ remoteHost: "host", remoteShare: "" })).toBe(false);
      expect(isRemoteInfo({ remoteHost: "host", remoteShare: "  " })).toBe(
        false,
      );
    });

    it("should return true for valid RemoteInfo objects", () => {
      expect(isRemoteInfo({ remoteHost: "host", remoteShare: "share" })).toBe(
        true,
      );
      expect(
        isRemoteInfo({
          remoteHost: "192.168.1.1",
          remoteShare: "data",
          remoteUser: "user",
        }),
      ).toBe(true);
    });
  });

  describe("isRemoteFsType", () => {
    it("should return true for known remote filesystem types", () => {
      expect(isRemoteFsType("nfs")).toBe(true);
      expect(isRemoteFsType("smb")).toBe(true);
      expect(isRemoteFsType("cifs")).toBe(true);
      expect(isRemoteFsType("sshfs")).toBe(true);
      expect(isRemoteFsType("ftp")).toBe(true);
      expect(isRemoteFsType("webdav")).toBe(true);
    });

    it("should return false for local filesystem types", () => {
      expect(isRemoteFsType("ext4")).toBe(false);
      expect(isRemoteFsType("btrfs")).toBe(false);
      expect(isRemoteFsType("xfs")).toBe(false);
      expect(isRemoteFsType("ntfs")).toBe(false);
      expect(isRemoteFsType("apfs")).toBe(false);
    });

    it("should return false for undefined or blank input", () => {
      expect(isRemoteFsType(undefined)).toBe(false);
      expect(isRemoteFsType("")).toBe(false);
      expect(isRemoteFsType("   ")).toBe(false);
    });

    it("should match prefix with dot separator (e.g., nfs.v4)", () => {
      expect(isRemoteFsType("nfs.v4")).toBe(true);
      expect(isRemoteFsType("cifs.smb2")).toBe(true);
      expect(isRemoteFsType("smb.3")).toBe(true);
    });

    it("should not match partial prefix without dot", () => {
      // "nfsv4" should NOT match "nfs" because it doesn't start with "nfs."
      expect(isRemoteFsType("nfsv4")).toBe(false);
      expect(isRemoteFsType("smbclient")).toBe(false);
    });

    it("should normalize aliases before matching", () => {
      // nfs3 normalizes to nfs, which is in the network types
      expect(isRemoteFsType("nfs3")).toBe(true);
      // davfs2 normalizes to webdav
      expect(isRemoteFsType("davfs2")).toBe(true);
      // fuse.sshfs normalizes to sshfs
      expect(isRemoteFsType("fuse.sshfs")).toBe(true);
      // cephfs normalizes to ceph
      expect(isRemoteFsType("cephfs")).toBe(true);
    });

    it("should be case insensitive", () => {
      expect(isRemoteFsType("NFS")).toBe(true);
      expect(isRemoteFsType("CIFS")).toBe(true);
      expect(isRemoteFsType("SMB")).toBe(true);
    });

    it("should support custom networkFsTypes parameter", () => {
      const customTypes = ["myfs", "customnet"];
      expect(isRemoteFsType("myfs", customTypes)).toBe(true);
      expect(isRemoteFsType("customnet", customTypes)).toBe(true);
      expect(isRemoteFsType("myfs.v2", customTypes)).toBe(true);
      // nfs is NOT in our custom list
      expect(isRemoteFsType("nfs", customTypes)).toBe(false);
    });
  });

  describe("parseURL", () => {
    it("should return undefined for blank input", () => {
      expect(parseURL("")).toBeUndefined();
      expect(parseURL("   ")).toBeUndefined();
    });

    it("should return URL object for valid URL string", () => {
      const url = parseURL("http://example.com");
      expect(url).toBeInstanceOf(URL);
      expect(url?.href).toBe("http://example.com/");
    });

    it("should return undefined for invalid URL string", () => {
      expect(parseURL("invalid-url")).toBeUndefined();
    });
  });

  describe("extractRemoteInfo", () => {
    it("should return undefined for undefined or blank input", () => {
      expect(extractRemoteInfo(undefined)).toBeUndefined();
      expect(extractRemoteInfo("")).toBeUndefined();
      expect(extractRemoteInfo("   ")).toBeUndefined();
      expect(extractRemoteInfo(null as unknown as string)).toBeUndefined();
    });

    it("should return non-remote info for file protocol", () => {
      const result = extractRemoteInfo("file:///path/to/file");
      expect(result).toEqual({
        remote: false,
        uri: "file:///path/to/file",
      });
    });

    describe("SMB/CIFS pattern (//host/share)", () => {
      it("should parse with user", () => {
        const result = extractRemoteInfo("//user@host/share");
        expect(result).toEqual({
          remote: true,
          remoteUser: "user",
          remoteHost: "host",
          remoteShare: "share",
        });
      });

      it("should parse without user", () => {
        const result = extractRemoteInfo("//host/share");
        expect(result).toEqual({
          remote: true,
          remoteHost: "host",
          remoteShare: "share",
        });
      });

      it("should parse with nested share path", () => {
        const result = extractRemoteInfo("//host/share/subdir/file.txt");
        expect(result).toEqual({
          remote: true,
          remoteHost: "host",
          remoteShare: "share/subdir/file.txt",
        });
      });

      it("should parse IP address as host", () => {
        const result = extractRemoteInfo("//192.168.1.100/data");
        expect(result).toEqual({
          remote: true,
          remoteHost: "192.168.1.100",
          remoteShare: "data",
        });
      });
    });

    describe("sshfs pattern", () => {
      it("should parse with protocol prefix", () => {
        const result = extractRemoteInfo("sshfs#USER@HOST:REMOTE/PATH");
        expect(result).toEqual({
          remote: true,
          remoteUser: "USER",
          remoteHost: "HOST",
          remoteShare: "REMOTE/PATH",
          protocol: "sshfs",
        });
      });

      it("should parse without protocol prefix (user@host:path)", () => {
        const result = extractRemoteInfo("user@host:/path/to/dir");
        expect(result).toEqual({
          remote: true,
          remoteUser: "user",
          remoteHost: "host",
          remoteShare: "/path/to/dir",
        });
      });

      it("should return undefined for empty path (remoteShare required)", () => {
        // isRemoteInfo requires remoteShare to be non-blank
        const result = extractRemoteInfo("user@host:");
        expect(result).toBeUndefined();
      });
    });

    describe("NFS pattern (host:/path)", () => {
      it("should parse basic NFS mount", () => {
        const result = extractRemoteInfo("host:/share");
        expect(result).toEqual({
          remote: true,
          remoteHost: "host",
          remoteShare: "share",
          protocol: "nfs",
        });
      });

      it("should parse with nested path", () => {
        const result = extractRemoteInfo("nfs-server:/exports/data/project");
        expect(result).toEqual({
          remote: true,
          remoteHost: "nfs-server",
          remoteShare: "exports/data/project",
          protocol: "nfs",
        });
      });

      it("should not match URLs (double slash after colon)", () => {
        // http://host/path should NOT match NFS pattern
        // It should be parsed as URL instead (non-remote, so no protocol in result)
        const result = extractRemoteInfo("http://host/path");
        expect(result).toEqual({
          remote: false,
          uri: "http://host/path",
        });
      });
    });

    describe("URL parsing", () => {
      it("should return remote info for remote URL protocols", () => {
        const result = extractRemoteInfo("smb://user@host/share");
        expect(result).toEqual({
          remote: true,
          uri: "smb://user@host/share",
          protocol: "smb",
          remoteHost: "host",
          remoteShare: "share",
          remoteUser: "user",
        });
      });

      it("should return remote info for nfs URL", () => {
        const result = extractRemoteInfo("nfs://server/export");
        expect(result).toEqual({
          remote: true,
          uri: "nfs://server/export",
          protocol: "nfs",
          remoteHost: "server",
          remoteShare: "export",
        });
      });

      it("should return non-remote for non-network URL protocols", () => {
        const result = extractRemoteInfo("http://example.com/path");
        expect(result).toEqual({
          remote: false,
          uri: "http://example.com/path",
        });
      });

      it("should return non-remote for https URLs", () => {
        const result = extractRemoteInfo("https://example.com/path");
        expect(result).toEqual({
          remote: false,
          uri: "https://example.com/path",
        });
      });

      it("should normalize URL protocol aliases", () => {
        // webdav is in the network fs types
        const result = extractRemoteInfo("webdav://server/dav");
        expect(result?.remote).toBe(true);
        expect(result?.protocol).toBe("webdav");
      });
    });

    describe("custom networkFsTypes", () => {
      it("should use custom types to determine remote status", () => {
        const customTypes = ["customfs"];
        const result = extractRemoteInfo("customfs://host/share", customTypes);
        expect(result).toEqual({
          remote: true,
          uri: "customfs://host/share",
          protocol: "customfs",
          remoteHost: "host",
          remoteShare: "share",
        });
      });

      it("should treat normally-remote types as local with custom list", () => {
        const customTypes = ["myfs"]; // nfs is NOT in the list
        const result = extractRemoteInfo("nfs://host/share", customTypes);
        expect(result).toEqual({
          remote: false,
          uri: "nfs://host/share",
        });
      });
    });

    it("should return undefined for invalid/unrecognized input", () => {
      expect(extractRemoteInfo("invalid-url")).toBeUndefined();
      expect(extractRemoteInfo("just-a-string")).toBeUndefined();
      expect(extractRemoteInfo("/local/path")).toBeUndefined();
    });
  });
});
