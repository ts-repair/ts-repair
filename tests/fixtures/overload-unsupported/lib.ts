// Arrow function - cannot have overloads
const arrowProcess = (data: string[]): void => {
  console.log(data);
};

// Function expression - cannot have overloads
const funcExprProcess = function (data: number[]): void {
  console.log(data);
};

// Class with method - method calls not supported by builder
class DataProcessor {
  process(data: string[]): void;
  process(data: number[]): void;
  process(data: unknown[]): void {
    console.log(data);
  }
}

// Trigger TS2769 on arrow function (will have no fix from builder)
const mixedArrow = [true, "hello"];
arrowProcess(mixedArrow);

// Trigger TS2769 on function expression (will have no fix from builder)
const mixedFuncExpr = [true, 123];
funcExprProcess(mixedFuncExpr);

// Trigger TS2769 on class method (will have no fix from builder)
const processor = new DataProcessor();
const mixedClass = [true, "world"];
processor.process(mixedClass);
