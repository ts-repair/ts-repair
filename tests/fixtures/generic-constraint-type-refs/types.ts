// Type references in a union - this pattern cannot be analyzed without TypeChecker
// The builder should gracefully skip this case rather than produce incorrect results

interface CreateAction {
  type: "create";
  payload: { name: string };
}

interface UpdateAction {
  type: "update";
  payload: { id: string; name: string };
}

// Union using type references - discriminator detection should skip this
export type Action = CreateAction | UpdateAction;

// Generic function requiring the union constraint
export function processAction<T extends Action>(action: T): void {
  console.log(action.type);
}
