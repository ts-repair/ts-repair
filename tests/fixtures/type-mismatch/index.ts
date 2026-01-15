// Type mismatch - assigning string to number
function processNumber(n: number): number {
  return n * 2;
}

const value: string = "hello";
const result: number = value; // Error: Type 'string' is not assignable to type 'number'
