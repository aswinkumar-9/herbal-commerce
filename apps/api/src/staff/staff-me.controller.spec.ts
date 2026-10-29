import { UnauthorizedException } from '@nestjs/common';
import { StaffAuthService } from './staff-auth.service';
import { StaffMeController } from './staff-me.controller';

const USER = { id: 'staff-1', sessionId: 'session-1' };

function controllerWith(profile: unknown) {
  const staffAuth = { getProfile: jest.fn().mockResolvedValue(profile) };
  return {
    controller: new StaffMeController(
      staffAuth as unknown as StaffAuthService,
    ),
    staffAuth,
  };
}

describe('StaffMeController', () => {
  it("returns the caller's own profile, looked up by the ID in the token", async () => {
    const profile = { id: 'staff-1', email: 'dev.admin@example.com' };
    const { controller, staffAuth } = controllerWith(profile);

    await expect(controller.me(USER)).resolves.toEqual(profile);
    expect(staffAuth.getProfile).toHaveBeenCalledWith('staff-1');
  });

  it('answers 401 if the account no longer exists', async () => {
    const { controller } = controllerWith(null);

    await expect(controller.me(USER)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
