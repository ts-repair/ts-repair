import type { InfiniteRecurse, Flatten, DeepReadonly } from "./types.js";

// Attempt to instantiate the problematic recursive type
// This should trigger TS2589: Type instantiation is excessively deep and possibly infinite
type TooDeep = InfiniteRecurse<string>;

// Complex nested structure to flatten
type Complex = Promise<Array<Promise<Array<Promise<string>>>>>;
type Flattened = Flatten<Complex>;

// Apply DeepReadonly to a nested structure
type Nested = {
  a: { b: { c: { d: { e: { f: { g: { h: { i: { j: string } } } } } } } } };
};
type ReadonlyNested = DeepReadonly<Nested>;

// Use the types so they get evaluated
export function useTooDeep(value: TooDeep): void {
  console.log(value);
}

export function useFlattened(value: Flattened): void {
  console.log(value);
}

export function useReadonly(value: ReadonlyNested): void {
  console.log(value);
}
