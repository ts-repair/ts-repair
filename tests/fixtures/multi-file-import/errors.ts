// Error types used across multiple files

export class HTTPError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "HTTPError";
  }
}

export class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
