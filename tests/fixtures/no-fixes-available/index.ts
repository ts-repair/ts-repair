// Errors that TypeScript can't auto-fix
// These require human judgment

// Missing return in function
function getValue(): string {
  const x = "hello";
  // Error: A function whose declared type is neither 'undefined', 'void', nor 'any' must return a value.
}

// Using undeclared variable (no spelling suggestion available)
console.log(completelyMadeUpVariableName);
