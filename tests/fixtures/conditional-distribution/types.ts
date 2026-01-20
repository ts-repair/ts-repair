// Conditional type with naked type parameter
type Filter<T, U> = T extends U ? T : never;

// Higher-order type that depends on Filter
type StringFilter<T> = Filter<T, string>;

// This function tries to return a concrete value but the return type
// is a conditional type that distributes, causing a type mismatch
function extractString<T>(_value: T): StringFilter<T> {
  // TS2322: Type '"default"' is not assignable to type 'Filter<T, string>'
  // This is because Filter<T, string> is a distributive conditional type
  // When T is unknown, it doesn't simplify to anything assignable from string
  return "default";
}

// Another distribution-prone type for testing
type IsArray<T> = T extends unknown[] ? true : false;

export { Filter, StringFilter, extractString, IsArray };
