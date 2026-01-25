/**
 * Fixture demonstrating conditional type distribution issues.
 *
 * Distribution causes conditional types to be applied to each member of a union
 * separately, which can lead to type errors with unions visible in the message.
 */

// Distributive conditional type
type ToArray<T> = T extends unknown ? T[] : never;

// ToArray<string | number> distributes to string[] | number[]
// This means you can't assign a mixed array (string | number)[] to it

// Concrete usage that shows the union in the error message
type Input = string | number;

// TS2322: Type '(string | number)[]' is not assignable to type 'string[] | number[]'
// The error message contains the union pattern which we can detect
const items: ToArray<Input> = [1, "hello", 2, "world"];

export { ToArray, Input, items };
