import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env';
import { AccessTokenGuard } from './access-token.guard';
import { AccessTokenService } from './access-token.service';
import type { Audience } from './access-token.service';
import { Public } from './public.decorator';
import { SessionService } from './session.service';
import { StaffOnly } from './staff-only.decorator';

const USER = { id: 'user-1', sessionId: 'session-1' };
// Obviously fake test value.
const SECRET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';

// Stand-ins for real controllers, decorated the way real ones are.
class CustomerRoutes {
  @Public()
  open() {}

  me() {}
}

@StaffOnly()
class StaffRoutes {
  @Public()
  login() {}

  me() {}
}

class MixedRoutes {
  @StaffOnly()
  forStaff() {}

  forCustomers() {}
}

type Controller = { prototype: object };

// The guard with the real Reflector, so the decorators above really count.
function setup(controller: Controller, handler: string, authorization?: string) {
  const accessTokens = { verify: jest.fn().mockResolvedValue(USER) };
  const sessions = {
    liveSessionRole: jest.fn().mockResolvedValue('CUSTOMER'),
  };
  const request: { headers: { authorization?: string }; user?: unknown } = {
    headers: { authorization },
  };
  const response = { setHeader: jest.fn() };
  const context = {
    getHandler: () =>
      (controller.prototype as Record<string, unknown>)[handler],
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  const guard = new AccessTokenGuard(
    new Reflector(),
    accessTokens as unknown as AccessTokenService,
    sessions as unknown as SessionService,
  );
  return { guard, context, accessTokens, sessions, request, response };
}

describe('AccessTokenGuard', () => {
  it('lets @Public() routes through without a token, on staff controllers too', async () => {
    const routes: [Controller, string][] = [
      [CustomerRoutes, 'open'],
      [StaffRoutes, 'login'],
    ];
    for (const [controller, handler] of routes) {
      const { guard, context, accessTokens } = setup(controller, handler);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(accessTokens.verify).not.toHaveBeenCalled();
    }
  });

  it('rejects requests without a bearer token', async () => {
    for (const header of [undefined, '', 'Basic dXNlcjpwYXNz', 'Bearer', 'Bearer a b']) {
      const { guard, context, accessTokens } = setup(CustomerRoutes, 'me', header);

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(accessTokens.verify).not.toHaveBeenCalled();
    }
  });

  it('rejects an invalid or expired token without asking the database', async () => {
    const { guard, context, accessTokens, sessions } = setup(
      CustomerRoutes,
      'me',
      'Bearer bad.token',
    );
    accessTokens.verify.mockRejectedValue(new Error('jwt expired'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired access token',
    );
    expect(sessions.liveSessionRole).not.toHaveBeenCalled();
  });

  it('rejects a valid token whose session has ended', async () => {
    const { guard, context, sessions, request } = setup(
      CustomerRoutes,
      'me',
      'Bearer good.token',
    );
    sessions.liveSessionRole.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired access token',
    );
    expect(request.user).toBeUndefined();
  });

  it('lets a live session through, sets the caller and turns off caching', async () => {
    const { guard, context, accessTokens, sessions, request, response } =
      setup(CustomerRoutes, 'me', 'bearer good.token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(accessTokens.verify).toHaveBeenCalledWith('good.token', 'customer');
    expect(sessions.liveSessionRole).toHaveBeenCalledWith(
      'user-1',
      'session-1',
      'customer',
    );
    expect(request.user).toEqual({ ...USER, role: 'CUSTOMER' });
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  // New in Part 3B-3: staff routes.
  it('checks the token and the session as staff on staff routes', async () => {
    const routes: [Controller, string, Audience][] = [
      [StaffRoutes, 'me', 'staff'],
      [MixedRoutes, 'forStaff', 'staff'],
      // @StaffOnly() on one handler leaves the others for customers.
      [MixedRoutes, 'forCustomers', 'customer'],
    ];
    for (const [controller, handler, audience] of routes) {
      const { guard, context, accessTokens, sessions } = setup(
        controller,
        handler,
        'Bearer good.token',
      );

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(accessTokens.verify).toHaveBeenCalledWith('good.token', audience);
      expect(sessions.liveSessionRole).toHaveBeenCalledWith(
        'user-1',
        'session-1',
        audience,
      );
    }
  });

  it('never lets a token open a route of the other audience', async () => {
    // Real tokens and real checks: only the audience differs.
    const tokens = new AccessTokenService(new JwtService(), {
      get: () => SECRET,
    } as unknown as ConfigService<Env, true>);
    // Real tokens carry real IDs.
    const person = {
      id: '6f1c2c4e-8a52-4f0e-9a43-3b8f2d7c1a10',
      sessionId: '0b7e5d2a-3c41-4e8f-b6a9-5d2c7e1f9a34',
    };
    const customerToken = await tokens.sign(person, 'customer');
    const staffToken = await tokens.sign(person, 'staff');
    const cases: [Controller, string, string, boolean][] = [
      [CustomerRoutes, 'me', customerToken, true],
      [StaffRoutes, 'me', staffToken, true],
      [StaffRoutes, 'me', customerToken, false],
      [MixedRoutes, 'forStaff', customerToken, false],
      [CustomerRoutes, 'me', staffToken, false],
      [MixedRoutes, 'forCustomers', staffToken, false],
    ];
    for (const [controller, handler, token, allowed] of cases) {
      const { guard, context, accessTokens, sessions } = setup(
        controller,
        handler,
        `Bearer ${token}`,
      );
      accessTokens.verify.mockImplementation(
        (raw: string, audience: Audience) => tokens.verify(raw, audience),
      );

      if (allowed) {
        await expect(guard.canActivate(context)).resolves.toBe(true);
      } else {
        await expect(guard.canActivate(context)).rejects.toThrow(
          'Invalid or expired access token',
        );
        expect(sessions.liveSessionRole).not.toHaveBeenCalled();
      }
    }
  });

  // New in Part 3B-4: the role, for the permission checks on staff routes.
  it("sets the caller's role as the database has it now, never from the token", async () => {
    const { guard, context, sessions, request } = setup(
      StaffRoutes,
      'me',
      'Bearer good.token',
    );
    sessions.liveSessionRole.mockResolvedValue('SUPER_USER');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ ...USER, role: 'SUPER_USER' });
  });
});
