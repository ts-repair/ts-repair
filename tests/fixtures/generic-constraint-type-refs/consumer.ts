import type { Action } from "./types.js";

// TS2344: Type 'MyAction' does not satisfy the constraint 'Action'
// The union Action is made of type references, so discriminator detection won't work
// The builder should still match and generate a candidate (but without discriminator tag)
interface MyAction {
  payload: { name: string };
}

// Using a type that explicitly requires the constraint
type ActionHandler<T extends Action> = (action: T) => void;

// This will produce TS2344 because MyAction doesn't satisfy Action constraint
type MyActionHandler = ActionHandler<MyAction>;
