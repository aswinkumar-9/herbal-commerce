import { Reflector } from '@nestjs/core';
import { RATE_LIMIT } from '../rate-limit/rate-limit.decorator';
import { StaffAuthController } from '../staff/staff-auth.controller';
import { StaffAdminsController } from '../staff/staff-admins.controller';
import { AuthController } from './auth.controller';

// The per-IP limit of each handler, read from its @RateLimit() decorator.
function routeLimits(controller: { prototype: object }) {
  const reflector = new Reflector();
  const handlers = controller.prototype as Record<string, () => unknown>;
  return Object.fromEntries(
    Object.getOwnPropertyNames(handlers)
      .filter((name) => name !== 'constructor')
      .map((name) => [name, reflector.get<string[]>(RATE_LIMIT, handlers[name])]),
  );
}

describe('rate-limited routes', () => {
  it('give every sign-up, sign-in and password reset endpoint its own per-IP limit', () => {
    expect(routeLimits(AuthController)).toEqual({
      register: ['register'],
      verifyEmail: ['verifyEmail'],
      resendVerification: ['resendByIp'],
      login: ['login'],
      refresh: ['refresh'],
      logout: ['logout'],
      forgotPassword: ['forgotPassword'],
      resetPassword: ['resetPassword'],
    });
    expect(routeLimits(StaffAuthController)).toEqual({
      login: ['staffLogin'],
      refresh: ['refresh'],
      logout: ['logout'],
      acceptInvite: ['acceptInvite'],
    });
    // Strict, so a handler without a limit must be listed too.
    expect(routeLimits(StaffAdminsController)).toStrictEqual({
      // Reading the list and changing a status have only the per-IP baseline.
      list: undefined,
      invite: ['staffInvites'],
      setStatus: undefined,
    });
  });
});
