import { WrappedError } from "./error";

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
    const cause: unknown = { key: "value" };
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

  it("should handle empty/blank causes correctly", () => {
    const error1 = new WrappedError("Context message", { cause: "" });
    expect(error1.message).toBe("Context message");

    const error2 = new WrappedError("Context message", { cause: null });
    expect(error2.message).toBe("Context message");

    const error3 = new WrappedError("Context message", { cause: undefined });
    expect(error3.message).toBe("Context message");
  });

  it("should set syscall, code, and path properties", () => {
    const error = new WrappedError("Context message", {
      syscall: "open",
      code: "ENOENT",
      path: "/tmp/missing.txt",
    });
    expect(error.syscall).toBe("open");
    expect(error.code).toBe("ENOENT");
    expect(error.path).toBe("/tmp/missing.txt");
    expect(error.details).toEqual({
      syscall: "open",
      code: "ENOENT",
      path: "/tmp/missing.txt",
    });
  });

  it("should handle blank name option", () => {
    const error = new WrappedError("Context message", { name: "" });
    expect(error.name).toBe("Error");
  });

  it("should handle invalid errno values", () => {
    const error1 = new WrappedError("Context message", {
      errno: "not a number" as unknown as number,
    });
    expect(error1.errno).toBeUndefined();

    const error2 = new WrappedError("Context message", {
      errno: null as unknown as number,
    });
    expect(error2.errno).toBeUndefined();
  });

  it("should handle details when there are no extra properties", () => {
    const error = new WrappedError("Simple error");
    expect(error.details).toEqual({});
    expect(error.toString()).toBe("Error: Simple error");
  });
});
