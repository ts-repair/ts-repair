// Types designed to trigger TS2589 "Type instantiation is excessively deep"

/**
 * Recursive type that forces deep instantiation.
 * The key is having a conditional type that recurses without a proper base case.
 */
export type InfiniteRecurse<T, Count extends number = 0> = Count extends 100
  ? T
  : InfiniteRecurse<InfiniteRecurse<T, Count>, Count>;

/**
 * Another problematic pattern: mutually recursive types
 */
export type A<T> = { value: B<T>[] };
export type B<T> = { nested: A<T> };

/**
 * DeepReadonly - a common utility type that can cause issues
 */
export type DeepReadonly<T> = T extends object
  ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
  : T;

/**
 * Flatten type that recurses into arrays and promises
 */
export type Flatten<T> = T extends Array<infer U>
  ? Flatten<U>
  : T extends Promise<infer V>
    ? Flatten<V>
    : T;
