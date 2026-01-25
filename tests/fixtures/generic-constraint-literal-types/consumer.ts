import type { BooleanResult, HttpStatus } from "./types.js";

// TS2344: Type 'MyBoolResult' does not satisfy the constraint 'BooleanResult<unknown>'
// Missing the boolean discriminator 'success: true | false'
interface MyBoolResult {
  data: string;
}

type BoolResultHandler<R extends BooleanResult<unknown>> = (result: R) => void;

// This will produce TS2344 - should generate fix with "success: true | false" (not strings!)
type MyBoolResultHandler = BoolResultHandler<MyBoolResult>;

// TS2344: Type 'MyStatus' does not satisfy the constraint 'HttpStatus'
// Missing the numeric discriminator 'code: 200 | 404 | 500'
interface MyStatus {
  body: string;
}

type StatusHandler<S extends HttpStatus> = (status: S) => void;

// This will produce TS2344 - should generate fix with "code: 200 | 404 | 500" (not strings!)
type MyStatusHandler = StatusHandler<MyStatus>;
