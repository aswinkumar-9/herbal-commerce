import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';
import { PasswordChangeService } from './password-change.service';
import { SessionService } from './session.service';

const USER = { id: 'user-1', sessionId: 'session-1', role: 'CUSTOMER' as const };

function controllerWith(profile: unknown) {
  const auth = {
    getProfile: jest.fn().mockResolvedValue(profile),
    updateProfile: jest.fn().mockResolvedValue(profile),
  };
  const passwordChange = {
    change: jest.fn().mockResolvedValue({ message: 'changed' }),
  };
  const sessions = { endAll: jest.fn().mockResolvedValue(undefined) };
  return {
    controller: new MeController(
      auth as unknown as AuthService,
      passwordChange as unknown as PasswordChangeService,
      sessions as unknown as SessionService,
    ),
    auth,
    passwordChange,
    sessions,
  };
}

describe('MeController', () => {
  it("returns the caller's own profile, looked up by the ID in the token", async () => {
    const profile = { id: 'user-1', email: 'aswin@example.com' };
    const { controller, auth } = controllerWith(profile);

    await expect(controller.me(USER)).resolves.toEqual(profile);
    expect(auth.getProfile).toHaveBeenCalledWith('user-1');
  });

  it('answers 401 if the account no longer exists', async () => {
    const { controller } = controllerWith(null);

    await expect(controller.me(USER)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // New in Part 3C-1.
  it("changes the caller's own name, by the ID in the token", async () => {
    const profile = { id: 'user-1', fullName: 'Asha K' };
    const { controller, auth } = controllerWith(profile);

    await expect(
      controller.update(USER, { fullName: 'Asha K' }),
    ).resolves.toEqual(profile);
    expect(auth.updateProfile).toHaveBeenCalledWith('user-1', {
      fullName: 'Asha K',
    });
  });

  it('answers 401 to a change if the account no longer exists', async () => {
    const { controller } = controllerWith(null);

    await expect(
      controller.update(USER, { fullName: 'Asha K' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("changes the caller's own password, by the ID in the token", async () => {
    const { controller, passwordChange } = controllerWith(null);
    const body = {
      currentPassword: 'the-current-password-1',
      newPassword: 'a-brand-new-password-2',
    };

    await expect(
      controller.changePassword(USER, body, '203.0.113.7'),
    ).resolves.toEqual({ message: 'changed' });
    expect(passwordChange.change).toHaveBeenCalledWith(
      'user-1',
      body,
      '203.0.113.7',
    );
  });

  it('signs the caller out everywhere, by the ID in the token', async () => {
    const { controller, sessions } = controllerWith(null);

    await expect(controller.signOutEverywhere(USER)).resolves.toBeUndefined();
    expect(sessions.endAll).toHaveBeenCalledWith('user-1');
  });
});
