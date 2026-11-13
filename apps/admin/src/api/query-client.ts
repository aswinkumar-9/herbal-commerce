import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-error';

// Whether to ask once more after a read failed: only when the server could
// not be reached or had a problem. A refusal (400, 403, 404 ...) would only
// be refused again.
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return (
    failureCount < 1 &&
    error instanceof ApiError &&
    (error.status === 0 || error.status >= 500)
  );
}

// The console's cache of what the API answered. The SessionProvider empties
// it when the session ends. Changes are never sent twice on their own: staff
// see what failed and choose to try again.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
