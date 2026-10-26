import { Reflector } from '@nestjs/core';
import { HealthController } from '../health/health.controller';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { IS_PUBLIC } from './public.decorator';

// Every route needs an access token unless it is listed here, so making a
// route public means changing this list on purpose.
function publicHandlers(controller: { prototype: object }): string[] {
  const reflector = new Reflector();
  const handlers = controller.prototype as Record<string, () => unknown>;
  return Object.getOwnPropertyNames(handlers).filter(
    (name) =>
      name !== 'constructor' &&
      reflector.get<boolean>(IS_PUBLIC, handlers[name]) === true,
  );
}

describe('public routes', () => {
  it('are exactly the sign-up, sign-in, password reset and health endpoints', () => {
    expect(publicHandlers(AuthController)).toEqual([
      'register',
      'verifyEmail',
      'resendVerification',
      'login',
      'refresh',
      'logout',
      'forgotPassword',
      'resetPassword',
    ]);
    expect(publicHandlers(HealthController)).toEqual(['live', 'ready']);
    expect(publicHandlers(MeController)).toEqual([]);
  });
});
