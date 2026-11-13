import { ApiError } from './api-error';

// What to tell staff when a request failed, in their words. The API's own
// message is used where it was written for them (a 400, 404 or 409 from the
// catalog); otherwise a calm sentence that says what to do.
export function problemMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Something went wrong. Try again.';
  }
  if (error.status === 0) {
    return error.message;
  }
  if (error.status === 401) {
    return 'Your session has ended. Sign in again.';
  }
  if (error.status === 403) {
    return "Your role can't do this.";
  }
  if (error.status === 429) {
    return error.retryAfterSeconds
      ? `Too many tries. Wait ${waitFor(error.retryAfterSeconds)} and try again.`
      : 'Too many tries. Wait a moment and try again.';
  }
  if (error.status >= 500) {
    return 'The server had a problem. Try again in a moment.';
  }
  if (error.fieldErrors.length > 0) {
    return 'Some details need changing: see the marked fields.';
  }
  return error.message;
}

// The API's word for each field it refused, first message only, to show
// next to that field. Every field name becomes an own key, even an odd one
// such as "__proto__".
export function fieldProblems(error: unknown): Record<string, string> {
  const problems = new Map<string, string>();
  if (error instanceof ApiError) {
    for (const { field, message } of error.fieldErrors) {
      if (!problems.has(field)) {
        problems.set(field, message);
      }
    }
  }
  return Object.fromEntries(problems);
}

function waitFor(seconds: number): string {
  if (seconds >= 120) {
    return `${Math.ceil(seconds / 60)} minutes`;
  }
  return seconds === 1 ? '1 second' : `${seconds} seconds`;
}
