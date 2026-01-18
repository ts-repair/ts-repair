// File B - also uses HTTPError without importing it
// This tests that the planner can fix imports across multiple files

export function logError(error: unknown): void {
  if (error instanceof HTTPError) {
    console.error(`[HTTP ${error.statusCode}] ${error.message}`);
  } else {
    console.error(error);
  }
}
