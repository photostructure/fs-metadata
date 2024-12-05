import { WrappedError } from "../error.js";

describe("WrappedError", () => {
  it("should set the correct message when cause is an Error", () => {
    const cause = new Error("Original error");
    const error = new WrappedError("Context message", { cause });

    expect(error.message).toBe("Context message: Original error");
    expect(error.cause).toBe(cause);
    expect(error.stack).toContain("Caused by: " + cause.stack);
  });

  it("should set the correct message when cause is a string", () => {
    const cause = "String cause";
    const error = new WrappedError("Context message", { cause });

    expect(error.message).toBe("Context message: String cause");
    expect(error.cause).toBeInstanceOf(Error);
    expect(String(error.cause)).toBe("Error: " + cause);
  });

  it("should handle non-Error and non-string causes", () => {
    const cause = { key: "value" };
    const error = new WrappedError("Context message", { cause });
    expect(error.toString()).toBe('Error: Context message: {"key":"value"}');
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("supports setting the error name", () => {
    const error = new WrappedError("Context message", {
      name: "CustomError",
      errno: 42,
    });
    expect(error.name).toBe("CustomError");
    expect(error.toString()).toBe(`CustomError: Context message {"errno":42}`);
  });
});
