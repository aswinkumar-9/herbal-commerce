export interface FieldError {
  field: string;
  message: string;
}

// A request the API refused, or one that never reached it (status 0).
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  // From Retry-After, when the API says how long to wait (429, 503).
  readonly retryAfterSeconds: number | undefined;
  // From a 400 "Validation failed": field names and messages only.
  readonly fieldErrors: FieldError[];

  constructor(
    status: number,
    message: string,
    details: {
      code?: string | undefined;
      retryAfterSeconds?: number | undefined;
      fieldErrors?: FieldError[] | undefined;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = details.code;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.fieldErrors = details.fieldErrors ?? [];
  }
}

export const UNREACHABLE =
  "The console can't reach the server. Check the connection and try again.";
