import { WrappedError } from "../error.js";

describe("WrappedError", () => {
  it("should set the correct message when cause is an Error", () => {
    const cause = new Error("Original error");
    const error = new WrappedError("Context message", cause);

    expect(error.message).toBe("Context message: Original error");
    expect(error.cause).toBe(cause);
    expect(error.stack).toContain("Caused by: " + cause.stack);
  });

  it("should set the correct message when cause is a string", () => {
    const cause = "String cause";
    const error = new WrappedError("Context message", cause);

    expect(error.message).toBe("Context message: String cause");
    expect(error.cause).toBe(cause);
  });

  it("should handle non-Error and non-string causes", () => {
    const cause = { key: "value" };
    const error = new WrappedError("Context message", cause);

    expect(error.message).toBe("Context message: [object Object]");
    expect(error.cause).toBe(cause);
  });
});
