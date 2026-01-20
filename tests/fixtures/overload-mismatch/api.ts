// Overloaded function designed to produce TS2769
export function convert(value: string, options: { encoding: "utf8" }): Buffer;
export function convert(value: number, options: { radix: number }): string;
export function convert(value: unknown, options: unknown): unknown {
  return value;
}

// Another example that's more likely to trigger TS2769
export function process(data: string[]): void;
export function process(data: number[]): void;
export function process(data: unknown[]): void {
  // implementation
}
