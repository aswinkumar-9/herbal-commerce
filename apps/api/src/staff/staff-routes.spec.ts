import { Reflector } from '@nestjs/core';
import { STAFF_ONLY } from '../auth/staff-only.decorator';
import { SUPER_USER_ONLY } from '../auth/super-user-only.decorator';
import { StaffAdminsController } from './staff-admins.controller';
import { StaffAuthController } from './staff-auth.controller';
import { StaffMeController } from './staff-me.controller';

describe('staff routes', () => {
  const reflector = new Reflector();

  it('are staff only as whole controllers, so a new route cannot be missed', () => {
    for (const controller of [
      StaffAuthController,
      StaffMeController,
      StaffAdminsController,
    ]) {
      expect([controller.name, reflector.get(STAFF_ONLY, controller)]).toEqual([
        controller.name,
        true,
      ]);
    }
  });

  // New in Part 3B-4.
  it('manage Admins for Super Users only, as a whole controller', () => {
    expect(reflector.get(SUPER_USER_ONLY, StaffAdminsController)).toBe(true);
    for (const controller of [StaffAuthController, StaffMeController]) {
      expect(reflector.get(SUPER_USER_ONLY, controller)).toBeUndefined();
    }
  });
});
