export type DeepReadonly<T> = T extends (infer R)[]
  ? ReadonlyArray<DeepReadonly<R>>
  : T extends Function
    ? T
    : T extends object
      ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
      : T;

export type OrDeepReadonly<T> = T | DeepReadonly<T>;

export function deepFreeze<T>(obj: T): DeepReadonly<T> {
  if (obj == null || typeof obj !== "object" || Object.isFrozen(obj)) {
    return obj as any;
  }
  if (Array.isArray(obj)) {
    return Object.freeze(obj.map(deepFreeze)) as any;
  }
  const result = {} as any;
  for (const [key, value] of Object.entries(obj)) {
    result[key] = deepFreeze(value);
  }
  return Object.freeze(result);
}
