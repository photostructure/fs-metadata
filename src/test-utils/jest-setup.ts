// Jest setup file - runs before all tests
// Configures global test environment and timeouts

import { jest } from "@jest/globals";
import { getTestTimeout } from "./test-timeout-config";

// Configure Jest timeout globally for all tests
jest.setTimeout(getTestTimeout());

// Set consistent timezone for tests (similar to PhotoStructure approach)
process.env["TZ"] = "America/Los_Angeles";

// Ensure test environment
process.env["NODE_ENV"] = "test";
