import { describe, expect, it } from 'vitest';
import { ApiError, UNREACHABLE } from './api-error';
import { fieldProblems, problemMessage } from './problems';

describe('what staff are told when a request failed', () => {
  it.each([
    [new ApiError(0, UNREACHABLE), UNREACHABLE],
    [
      new ApiError(401, 'Unauthorized'),
      'Your session has ended. Sign in again.',
    ],
    [new ApiError(403, 'Forbidden resource'), "Your role can't do this."],
    [
      new ApiError(429, 'ThrottlerException', { retryAfterSeconds: 1 }),
      'Too many tries. Wait 1 second and try again.',
    ],
    [
      new ApiError(429, 'ThrottlerException', { retryAfterSeconds: 42 }),
      'Too many tries. Wait 42 seconds and try again.',
    ],
    [
      new ApiError(429, 'ThrottlerException', { retryAfterSeconds: 119 }),
      'Too many tries. Wait 119 seconds and try again.',
    ],
    [
      new ApiError(429, 'ThrottlerException', { retryAfterSeconds: 121 }),
      'Too many tries. Wait 3 minutes and try again.',
    ],
    [
      new ApiError(429, 'ThrottlerException'),
      'Too many tries. Wait a moment and try again.',
    ],
    [
      new ApiError(500, 'Internal server error at products.service.ts:42'),
      'The server had a problem. Try again in a moment.',
    ],
    [
      new ApiError(503, 'Service Unavailable'),
      'The server had a problem. Try again in a moment.',
    ],
    [
      new ApiError(400, 'Validation failed', {
        fieldErrors: [{ field: 'name', message: 'Name is required' }],
      }),
      'Some details need changing: see the marked fields.',
    ],
    [
      new ApiError(409, 'A category with this slug already exists.'),
      'A category with this slug already exists.',
    ],
    [
      new ApiError(404, 'There is no such product.'),
      'There is no such product.',
    ],
  ])('%s', (error, message) => {
    expect(problemMessage(error)).toBe(message);
  });

  it('says nothing of an error that did not come from the API', () => {
    expect(problemMessage(new TypeError("reading 'name' of undefined"))).toBe(
      'Something went wrong. Try again.',
    );
  });
});

describe('the field problems', () => {
  it('keeps the first message for each field', () => {
    const error = new ApiError(400, 'Validation failed', {
      fieldErrors: [
        { field: 'name', message: 'Name is required' },
        { field: 'hsnCode', message: 'An HSN code has 4, 6 or 8 digits' },
        { field: 'name', message: 'At most 100 characters' },
      ],
    });

    expect(fieldProblems(error)).toEqual({
      name: 'Name is required',
      hsnCode: 'An HSN code has 4, 6 or 8 digits',
    });
  });

  it('makes every field its own key, even "__proto__"', () => {
    const error = new ApiError(400, 'Validation failed', {
      fieldErrors: [{ field: '__proto__', message: 'Odd' }],
    });

    const problems = fieldProblems(error);

    expect(Object.keys(problems)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(problems)).toBe(Object.prototype);
  });

  it('is empty for anything else', () => {
    expect(fieldProblems(new ApiError(409, 'Taken'))).toEqual({});
    expect(fieldProblems(new Error('boom'))).toEqual({});
  });
});
