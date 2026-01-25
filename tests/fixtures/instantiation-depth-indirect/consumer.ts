// Consumer file that triggers TS2589 at call sites
// The error appears here (at the usage sites),
// but the recursive type definition is in types.ts

import { unwrap, UnwrapPromise, deepFlatten, DeepFlatten } from "./types.js";

// Create a self-referential Promise type that causes infinite unwrapping
// This is the key: LoopPromise is a Promise of itself, so UnwrapPromise loops forever
interface LoopPromise extends Promise<LoopPromise> {}

// This triggers TS2589 because UnwrapPromise<LoopPromise> recurses infinitely
type Unwrapped = UnwrapPromise<LoopPromise>;

// Using the type at a call site also triggers the error
declare const loopValue: LoopPromise;
const result = unwrap(loopValue);

// Another pattern: self-referential array for DeepFlatten
interface LoopArray extends ReadonlyArray<LoopArray> {}

// This also triggers TS2589
type Flattened = DeepFlatten<LoopArray>;

// Call site with the looping array type
declare const loopArrayValue: LoopArray;
const flatResult = deepFlatten(loopArrayValue);

// Export to ensure types are evaluated
export { result, flatResult };
export type { Unwrapped, Flattened };
