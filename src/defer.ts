type Defer<T> = (() => T) & {
  reset: () => void;
};

/**
 * Creates a deferred value that is computed once on first access and cached for
 * subsequent accesses.
 * @param thunk A function that takes no arguments and returns a value
 * @returns A function that returns the computed value
 */
export function defer<T>(thunk: () => T): Defer<T> {
  let computed = false;
  let value: T;

  const fn = () => {
    if (!computed) {
      computed = true;
      value = thunk();
    }
    return value;
  };

  fn.reset = () => {
    computed = false;
  };

  return fn;
}
