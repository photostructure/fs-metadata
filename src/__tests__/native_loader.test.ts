// src/__tests__/native_loader.test.ts

import * as fs from "fs";
import { arch, platform } from "node:os";
import { native } from "../native_loader.js";

// Mock node:os functions
jest.mock("node:os", () => ({
  arch: jest.fn(),
  platform: jest.fn(),
}));

// Mock fs functions
jest.mock("node:fs", () => ({
  ...jest.requireActual("node:fs"),
  readdirSync: jest.fn(),
}));

describe("native_loader", () => {
  // Store original process object
  const originalProcessVersions = process.versions.modules;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    // Default platform values
    (platform as jest.Mock).mockReturnValue("linux");
    (arch as jest.Mock).mockReturnValue("x64");
    // Default filesystem structure
    (fs.readdirSync as jest.Mock).mockImplementation((dir: string) => {
      if (dir.endsWith("prebuilds")) {
        return ["linux-x64", "win32-x64", "darwin-x64"];
      }
      if (dir.includes("linux-x64")) {
        return ["node.abi93.node", "node.abi108.napi.node"];
      }
      return [];
    });

    // Mock modules version using Object.defineProperty
    Object.defineProperty(process.versions, "modules", {
      value: originalProcessVersions,
      configurable: true,
    });
  });

  describe("platform detection", () => {
    it("should find matching platform-arch tuple", () => {
      (platform as jest.Mock).mockReturnValue("linux");
      (arch as jest.Mock).mockReturnValue("x64");
      expect(() => native()).not.toThrow();
    });

    it("should throw error for unsupported platform", () => {
      (platform as jest.Mock).mockReturnValue("sunos");
      expect(() => native()).toThrow(/No prebuilt module found/);
    });

    it("should throw error for unsupported architecture", () => {
      (arch as jest.Mock).mockReturnValue("mips");
      expect(() => native()).toThrow(/No prebuilt module found/);
    });

    it("should handle multi-arch platforms", () => {
      (fs.readdirSync as jest.Mock).mockImplementation((dir: string) => {
        if (dir.endsWith("prebuilds")) {
          return ["darwin-x64+arm64"];
        }
        return ["node.abi108.node"];
      });

      (platform as jest.Mock).mockReturnValue("darwin");
      (arch as jest.Mock).mockReturnValue("arm64");
      expect(() => native()).not.toThrow();
    });
  });

  describe("ABI compatibility", () => {
    it("should select correct ABI version", () => {
      Object.defineProperty(process.versions, "modules", {
        value: "93",
        configurable: true,
      });
      expect(() => native()).not.toThrow();
    });

    it("should prefer napi modules when available", () => {
      (fs.readdirSync as jest.Mock).mockImplementation((dir: string) => {
        if (dir.endsWith("prebuilds")) {
          return ["linux-x64"];
        }
        if (dir.includes("linux-x64")) {
          return ["node.abi93.node", "node.napi.node", "node.abi108.node"];
        }
        return [];
      });

      expect(() => native()).not.toThrow();
    });

    it("should throw error when no compatible ABI is found", () => {
      Object.defineProperty(process.versions, "modules", {
        value: "999",
        configurable: true,
      });
      expect(() => native()).toThrow(/No compatible native module/);
    });
  });

  describe("module loading", () => {
    it("should cache the loaded module", () => {
      const firstCall = native();
      const secondCall = native();
      expect(firstCall).toBe(secondCall);
    });

    it("should handle errors during module loading", () => {
      // Mock readdirSync to return a non-existent module path
      (fs.readdirSync as jest.Mock).mockImplementation((dir: string) => {
        if (dir.endsWith("prebuilds")) {
          return ["linux-x64"];
        }
        return ["invalid.node"];
      });

      expect(() => native()).toThrow();
    });
  });

  describe("tag parsing", () => {
    it("should correctly parse module tags", () => {
      (fs.readdirSync as jest.Mock).mockImplementation((dir: string) => {
        if (dir.endsWith("prebuilds")) {
          return ["linux-x64"];
        }
        return ["node.abi93.uv1.napi.node"];
      });

      expect(() => native()).not.toThrow();
    });

    it("should ignore invalid tag formats", () => {
      (fs.readdirSync as jest.Mock).mockImplementation((dir: string) => {
        if (dir.endsWith("prebuilds")) {
          return ["linux-x64"];
        }
        return ["node.invalid.node", "node.abi93.node"];
      });

      expect(() => native()).not.toThrow();
    });
  });

  afterEach(() => {
    // Reset the modules version back to original
    Object.defineProperty(process.versions, "modules", {
      value: originalProcessVersions,
      configurable: true,
    });
  });
});
