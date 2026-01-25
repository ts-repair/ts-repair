// Non-exported function with overloads
function processInternal(data: string[]): string;
function processInternal(data: number[]): string;
function processInternal(data: unknown[]): string {
  return data.join(",");
}

// Async exported function with overloads
export async function fetchData(id: string): Promise<string>;
export async function fetchData(id: number): Promise<string>;
export async function fetchData(id: unknown): Promise<string> {
  return String(id);
}

// Function with explicit return type
export function compute(x: number, y: number): number;
export function compute(x: string, y: string): string;
export function compute(x: unknown, y: unknown): number | string {
  if (typeof x === "number" && typeof y === "number") {
    return x + y;
  }
  return String(x) + String(y);
}

// Call sites that trigger TS2769
const mixedInternal = [true, "hello"];
processInternal(mixedInternal);

const mixedArg = Symbol("test");
fetchData(mixedArg);

compute(true, false);
