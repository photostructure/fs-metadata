// src/remote_info.test.ts

import {
  extractRemoteInfo,
  isRemoteFsType,
  normalizeFsType,
  parseURL,
} from "./remote_info";

describe("remote_info tests", () => {
  describe("normalizeFsType", () => {
    it("should normalize protocol by converting to lowercase and removing trailing colon", () => {
      expect(normalizeFsType("HTTP:")).toBe("http");
      expect(normalizeFsType("ftp:")).toBe("ftp");
      expect(normalizeFsType("fuse.sshfs")).toBe("sshfs");
      expect(normalizeFsType("")).toBe("");
      expect(normalizeFsType(null as unknown as string)).toBe("");
    });
  });

  describe("isRemoteFsType", () => {
    it("should return true for known remote filesystem types", () => {
      expect(isRemoteFsType("nfs")).toBe(true);
      expect(isRemoteFsType("smb")).toBe(true);
      expect(isRemoteFsType("ftp")).toBe(true);
    });

    it("should return false for unknown filesystem types", () => {
      expect(isRemoteFsType("ext4")).toBe(false);
      expect(isRemoteFsType("btrfs")).toBe(false);
    });

    it("should return false for undefined or blank input", () => {
      expect(isRemoteFsType(undefined)).toBe(false);
      expect(isRemoteFsType("")).toBe(false);
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
    });

    it("should return non-remote info for file protocol", () => {
      const result = extractRemoteInfo("file:///path/to/file");
      expect(result).toEqual({
        remote: false,
        uri: "file:///path/to/file",
      });
    });

    it("should return remote info for SMB/CIFS pattern", () => {
      const result = extractRemoteInfo("//user@host/share");
      expect(result).toEqual({
        remote: true,
        remoteUser: "user",
        remoteHost: "host",
        remoteShare: "share",
      });
    });

    it("should return remote info for sshfs pattern", () => {
      const result = extractRemoteInfo("sshfs#USER@HOST:REMOTE/PATH");
      expect(result).toEqual({
        remote: true,
        remoteUser: "USER",
        remoteHost: "HOST",
        remoteShare: "REMOTE/PATH",
        protocol: "sshfs",
      });
    });

    it("should return remote info for NFS pattern", () => {
      const result = extractRemoteInfo("host:/share");
      expect(result).toEqual({
        remote: true,
        remoteHost: "host",
        remoteShare: "share",
        protocol: "nfs",
      });
    });

    it("should return remote info for valid URL", () => {
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

    it("should return undefined for invalid URL", () => {
      expect(extractRemoteInfo("invalid-url")).toBeUndefined();
    });
  });
});
