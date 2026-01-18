// File A - uses HTTPError without importing it
// This tests that multi-file import fixes work correctly

export function handleApiError(error: unknown): string {
  if (error instanceof HTTPError) {
    return `HTTP ${error.statusCode}: ${error.message}`;
  }
  return "Unknown error";
}
