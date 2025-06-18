// src/string_enum.ts

// See https://basarat.gitbooks.io/typescript/content/docs/types/literal-types.html

export type StringEnumType<T extends string> = {
  [K in T]: K;
};

export type StringEnum<T extends string> = StringEnumType<T> & {
  values: T[];
  size: number;
  get(s: string | undefined): T | undefined;
};

export type StringEnumKeys<Type> = Type extends StringEnum<infer X> ? X : never;

/**
 * Create a string enum with the given values. 

Example usage:

export const Directions = stringEnum("North", "South", "East", "West")
export type Direction = StringEnumKeys<typeof Directions>

*/
export function stringEnum<T extends string>(...o: T[]): StringEnum<T> {
  const set = new Set(o);

  const dict: StringEnumType<T> = {} as StringEnumType<T>;
  for (const key of o) {
    // eslint-disable-next-line security/detect-object-injection -- building dictionary from trusted input array
    dict[key] = key;
  }

  return {
    ...dict,
    values: Object.freeze([...set]) as T[],
    size: set.size,
    get: (s: string | undefined) =>
      s != null && set.has(s as T) ? (s as T) : undefined,
  };
}
