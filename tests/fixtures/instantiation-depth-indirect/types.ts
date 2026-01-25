// Recursive type definitions that will cause TS2589 when used at call sites
// The key: these types DON'T error on their own - they only error when instantiated
// with specific inputs that cause deep recursion

/**
 * UnwrapPromise recursively unwraps Promise types.
 * This causes infinite recursion when given a self-referential type.
 */
export type UnwrapPromise<T> = T extends Promise<infer U> ? UnwrapPromise<U> : T;

/**
 * DeepFlatten recursively flattens arrays.
 * This is valid by itself but errors when given complex nested types.
 */
export type DeepFlatten<T> = T extends ReadonlyArray<infer U>
  ? DeepFlatten<U>
  : T;

/**
 * Function that returns an UnwrapPromise<T> type.
 * The error appears at call sites, not here.
 */
export function unwrap<T>(value: T): UnwrapPromise<T> {
  return value as UnwrapPromise<T>;
}

/**
 * Function returning DeepFlatten<T>.
 */
export function deepFlatten<T>(value: T): DeepFlatten<T> {
  return value as DeepFlatten<T>;
}
