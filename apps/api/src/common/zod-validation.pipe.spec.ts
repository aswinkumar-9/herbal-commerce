import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(
    z.object({ password: z.string().min(10) }),
  );

  it('returns the parsed value when it is valid', () => {
    expect(pipe.transform({ password: 'long-enough-1' })).toEqual({
      password: 'long-enough-1',
    });
  });

  it('rejects invalid input without echoing the submitted value', () => {
    let caught: unknown;
    try {
      pipe.transform({ password: 'secret' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((caught as BadRequestException).getResponse())).not.toContain('secret');
  });
});
