import { describe, expect, it } from 'vitest';
import { waitFor } from './SignInPage';

describe('how long staff are told to wait', () => {
  it.each([
    [undefined, 'a few minutes'],
    [1, '1 second'],
    [45, '45 seconds'],
    [60, '1 minute'],
    // Rounded up: staff who come back on time are let in.
    [61, '2 minutes'],
    [900, '15 minutes'],
  ])('after %j seconds, says %j', (seconds, said) => {
    expect(waitFor(seconds)).toBe(said);
  });
});
