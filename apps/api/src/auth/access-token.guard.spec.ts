import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessTokenGuard } from './access-token.guard';
import { AccessTokenService } from './access-token.service';
import { SessionService } from './session.service';

const USER = { id: 'user-1', sessionId: 'session-1' };

function setup(authorization?: string) {
  const reflector = { get: jest.fn().mockReturnValue(undefined) };
  const accessTokens = { verify: jest.fn().mockResolvedValue(USER) };
  const sessions = { isActive: jest.fn().mockResolvedValue(true) };
  const request: { headers: { authorization?: string }; user?: unknown } = {
    headers: { authorization },
  };
  const response = { setHeader: jest.fn() };
  const context = {
    getHandler: () => () => undefined,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  const guard = new AccessTokenGuard(
    reflector as unknown as Reflector,
    accessTokens as unknown as AccessTokenService,
    sessions as unknown as SessionService,
  );
  return { guard, context, reflector, accessTokens, sessions, request, response };
}

describe('AccessTokenGuard', () => {
  it('lets @Public() routes through without a token', async () => {
    const { guard, context, reflector, accessTokens } = setup();
    reflector.get.mockReturnValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(accessTokens.verify).not.toHaveBeenCalled();
  });

  it('rejects requests without a bearer token', async () => {
    for (const header of [undefined, '', 'Basic dXNlcjpwYXNz', 'Bearer', 'Bearer a b']) {
      const { guard, context, accessTokens } = setup(header);

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(accessTokens.verify).not.toHaveBeenCalled();
    }
  });

  it('rejects an invalid or expired token without asking the database', async () => {
    const { guard, context, accessTokens, sessions } = setup('Bearer bad.token');
    accessTokens.verify.mockRejectedValue(new Error('jwt expired'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired access token',
    );
    expect(sessions.isActive).not.toHaveBeenCalled();
  });

  it('rejects a valid token whose session has ended', async () => {
    const { guard, context, sessions, request } = setup('Bearer good.token');
    sessions.isActive.mockResolvedValue(false);

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired access token',
    );
    expect(request.user).toBeUndefined();
  });

  it('lets a live session through, sets the caller and turns off caching', async () => {
    const { guard, context, accessTokens, sessions, request, response } =
      setup('bearer good.token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(accessTokens.verify).toHaveBeenCalledWith('good.token');
    expect(sessions.isActive).toHaveBeenCalledWith('user-1', 'session-1');
    expect(request.user).toEqual(USER);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
