// src/DeepFreeze.ts

export type DeepReadonly<T> = T extends (infer R)[]
  ? ReadonlyArray<DeepReadonly<R>>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  : T extends Function
    ? T 
    : T extends object
      ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
      : T;

export type OrDeepReadonly<T> = T | DeepReadonly<T>;

/**
 * Type guard to check if a value is an object (excluding null and arrays)
 */
function isObject(value: unknown): value is Record<string | symbol | number, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively freezes an object and all of its properties
 */
export function deepFreeze<T>(obj: T): DeepReadonly<T> {
  // Handle primitive types and frozen objects
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) {
    return obj as DeepReadonly<T>;
  }

  if (Array.isArray(obj)) {
    const frozenArray = Object.freeze(obj.map(deepFreeze)) as ReadonlyArray<DeepReadonly<T extends (infer U)[] ? U : never>>;
    return frozenArray as DeepReadonly<T>;
  }

  if (isObject(obj)) {
    const result = {} as T;
    
    Object.entries(obj as Record<string, unknown>).forEach(([key, value]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = deepFreeze(value);
    });
    
    return Object.freeze(result) as DeepReadonly<T>;
  }

  return obj as DeepReadonly<T>;
}