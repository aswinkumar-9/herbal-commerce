import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import './zod-config';

describe('zod in the console', () => {
  it('never tries `new Function`, which the page policy forbids', () => {
    expect(z.config().jitless).toBe(true);
  });
});
