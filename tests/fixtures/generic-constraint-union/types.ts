// Define a discriminated union constraint
export type Action =
  | { type: "create"; payload: { name: string } }
  | { type: "update"; payload: { id: string; name: string } }
  | { type: "delete"; payload: { id: string } };

// Generic function that requires Action constraint
export function processAction<T extends Action>(action: T): void {
  switch (action.type) {
    case "create":
      console.log("Creating:", action.payload.name);
      break;
    case "update":
      console.log("Updating:", action.payload.id, action.payload.name);
      break;
    case "delete":
      console.log("Deleting:", action.payload.id);
      break;
  }
}

// Another constraint with a discriminator
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export function handleResult<R extends Result<unknown>>(result: R): void {
  if (result.success) {
    console.log("Success:", result.data);
  } else {
    console.log("Error:", result.error);
  }
}
