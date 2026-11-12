import { describe, expect, it } from 'vitest';
import { ApiError, UNREACHABLE } from './api-error';
import { createQueryClient, shouldRetry } from './query-client';

describe('asking again after a read failed', () => {
  it('asks once more when the server could not be reached or had a problem', () => {
    expect(shouldRetry(0, new ApiError(0, UNREACHABLE))).toBe(true);
    expect(shouldRetry(0, new ApiError(500, 'Internal'))).toBe(true);
    expect(shouldRetry(0, new ApiError(503, 'Unavailable'))).toBe(true);
  });

  it('asks only once', () => {
    expect(shouldRetry(1, new ApiError(0, UNREACHABLE))).toBe(false);
    expect(shouldRetry(1, new ApiError(500, 'Internal'))).toBe(false);
  });

  it('never asks again after a refusal', () => {
    for (const status of [400, 401, 403, 404, 409, 429]) {
      expect(shouldRetry(0, new ApiError(status, 'No'))).toBe(false);
    }
    expect(shouldRetry(0, new Error('a bug'))).toBe(false);
  });

  it('is what the console uses, and changes are never sent twice on their own', () => {
    const options = createQueryClient().getDefaultOptions();

    expect(options.queries?.retry).toBe(shouldRetry);
    expect(options.queries?.refetchOnWindowFocus).toBe(false);
    expect(options.mutations?.retry).toBe(false);
  });
});
