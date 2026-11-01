import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';

const USER = { id: 'user-1', sessionId: 'session-1', role: 'CUSTOMER' as const };

function controllerWith(profile: unknown) {
  const auth = {
    getProfile: jest.fn().mockResolvedValue(profile),
    updateProfile: jest.fn().mockResolvedValue(profile),
  };
  return { controller: new MeController(auth as unknown as AuthService), auth };
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
});
