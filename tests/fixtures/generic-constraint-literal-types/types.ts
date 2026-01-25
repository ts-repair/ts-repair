// Test boolean discriminators
export type BooleanResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export function handleBoolResult<R extends BooleanResult<unknown>>(result: R): void {
  if (result.success) {
    console.log("Success:", result.data);
  } else {
    console.log("Error:", result.error);
  }
}

// Test numeric discriminators
export type HttpStatus =
  | { code: 200; body: string }
  | { code: 404; message: string }
  | { code: 500; error: Error };

export function handleStatus<S extends HttpStatus>(status: S): void {
  console.log("Status code:", status.code);
}
