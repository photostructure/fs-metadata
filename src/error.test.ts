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

  it("should inherit errno from a cause that is an Error with errno", () => {
    const cause = new Error("Original error") as Error & { errno?: number };
    cause.errno = 13;
    const error = new WrappedError("Context message", { cause });
    expect(error.errno).toBe(13);
  });

  it("should inherit code from a cause that is an Error with code", () => {
    const cause = new Error("Original error") as Error & { code?: string };
    cause.code = "EACCES";
    const error = new WrappedError("Context message", { cause });
    expect(error.code).toBe("EACCES");
  });

  it("should inherit syscall from a cause that is an Error with syscall", () => {
    const cause = new Error("Original error") as Error & { syscall?: string };
    cause.syscall = "chmod";
    const error = new WrappedError("Context message", { cause });
    expect(error.syscall).toBe("chmod");
  });

  it("should prefer explicit options over inherited values from cause", () => {
    const cause = new Error("Original error") as Error & {
      errno?: number;
      code?: string;
    };
    cause.errno = 13;
    cause.code = "EACCES";
    const error = new WrappedError("Context message", {
      cause,
      errno: 2,
      code: "ENOENT",
    });
    expect(error.errno).toBe(2);
    expect(error.code).toBe("ENOENT");
  });

  it("should handle blank code and syscall options", () => {
    const error = new WrappedError("Context message", {
      code: "",
      syscall: "   ",
      path: "",
    });
    expect(error.code).toBeUndefined();
    expect(error.syscall).toBeUndefined();
    expect(error.path).toBeUndefined();
  });

  it("should handle cause without stack", () => {
    const cause = { message: "Not a real error" };
    const error = new WrappedError("Context message", { cause });
    expect(error.stack).toBeDefined();
    // The cause object is converted to an Error in toError, so it will have a stack
    expect(error.stack).toContain("Caused by:");
  });

  it("should handle numeric causes", () => {
    const error = new WrappedError("Context message", { cause: 42 });
    expect(error.message).toBe("Context message: 42");
  });

  it("should handle boolean causes", () => {
    const errorFalse = new WrappedError("Context message", { cause: false });
    expect(errorFalse.message).toBe("Context message"); // false is falsy, so no cause added

    const errorTrue = new WrappedError("Context message", { cause: true });
    expect(errorTrue.message).toBe("Context message: true");
  });

  it("should handle array causes", () => {
    const error = new WrappedError("Context message", { cause: [1, 2, 3] });
    expect(error.message).toBe("Context message: [1,2,3]");
  });
});
