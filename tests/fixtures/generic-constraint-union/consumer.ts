import type { Action, Result } from "./types.js";

// TS2344: Type 'MyAction' does not satisfy the constraint 'Action'
// Missing the discriminator tag 'type'
interface MyAction {
  payload: { name: string };
}

// Using a type that explicitly requires the constraint
type ActionHandler<T extends Action> = (action: T) => void;

// This will produce TS2344 because MyAction doesn't satisfy Action constraint
type MyActionHandler = ActionHandler<MyAction>;

// TS2344: Type 'MyResult' does not satisfy the constraint 'Result<unknown>'
// Missing the discriminator tag 'success'
interface MyResult {
  data: string;
}

// Using a type that explicitly requires the constraint
type ResultProcessor<R extends Result<unknown>> = (result: R) => void;

// This will produce TS2344 because MyResult doesn't satisfy Result constraint
type MyResultProcessor = ResultProcessor<MyResult>;
