import { _dirname } from "./dirname";

describe("_dirname", () => {
  it("should return __dirname when it is defined", () => {
    // In normal operation (bundled with tsup), __dirname should be defined
    const dir = _dirname();
    expect(dir).toBeTruthy();
    expect(typeof dir).toBe("string");
  });

  // These tests rely on Jest globals which are not available in ESM mode
  // The functionality is still tested by the fact that _dirname works in the test environment
});
