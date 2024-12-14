// src/string_enum.test.ts

import { stringEnum, StringEnumKeys } from "./string_enum.js";


describe("stringEnum", () => {
  // Basic functionality tests
  it("creates enum with single value", () => {
    const Single = stringEnum("One");
    expect(Single.One).toBe("One");
    expect(Single.size).toBe(1);
  });

  it("creates enum with multiple values", () => {
    const Directions = stringEnum("North", "South", "East", "West");
    expect(Directions.North).toBe("North");
    expect(Directions.South).toBe("South");
    expect(Directions.East).toBe("East");
    expect(Directions.West).toBe("West");
  });

  it("maintains correct size property", () => {
    const Colors = stringEnum("Red", "Green", "Blue");
    expect(Colors.size).toBe(3);
  });

  // Values array tests
  it("creates frozen values array", () => {
    const Numbers = stringEnum("One", "Two", "Three");
    expect(Object.isFrozen(Numbers.values)).toBe(true);
    expect(Numbers.values).toEqual(["One", "Two", "Three"]);
  });

  it("maintains input order in values array", () => {
    const Letters = stringEnum("A", "B", "C");
    expect(Letters.values).toEqual(["A", "B", "C"]);
  });

  // Get method tests
  it("gets existing values", () => {
    const Colors = stringEnum("Red", "Green", "Blue");
    expect(Colors.get("Red")).toBe("Red");
    expect(Colors.get("Green")).toBe("Green");
    expect(Colors.get("Blue")).toBe("Blue");
  });

  it("returns undefined for non-existent values", () => {
    const Colors = stringEnum("Red", "Green", "Blue");
    expect(Colors.get("Yellow")).toBeUndefined();
  });

  it("handles undefined input in get method", () => {
    const Colors = stringEnum("Red", "Green", "Blue");
    expect(Colors.get(undefined)).toBeUndefined();
  });

  // Type checking
  it("type inference works correctly", () => {
    const Directions = stringEnum("North", "South", "East", "West");
    type Direction = StringEnumKeys<typeof Directions>;
    const direction: Direction = "North"; // Should compile
    expect(Directions.get(direction)).toBe("North");
  });

  // Edge cases
  it("handles empty enum", () => {
    const Empty = stringEnum();
    expect(Empty.size).toBe(0);
    expect(Empty.values).toEqual([]);
    expect(Empty.get("")).toBeUndefined();
  });

  it("handles duplicate values", () => {
    const Dupes = stringEnum("A", "A", "B");
    expect(Dupes.size).toBe(2);
    expect(Dupes.values).toEqual(["A", "B"]);
    expect(Dupes.get("A")).toBe("A");
  });
});
