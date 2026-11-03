import { Reflector } from '@nestjs/core';
import { STAFF_ONLY } from '../auth/staff-only.decorator';
import { SUPER_USER_ONLY } from '../auth/super-user-only.decorator';
import { StaffCategoriesController } from '../catalog/staff-categories.controller';
import { StaffAdminsController } from './staff-admins.controller';
import { StaffAuditLogController } from './staff-audit-log.controller';
import { StaffAuthController } from './staff-auth.controller';
import { StaffMeController } from './staff-me.controller';

describe('staff routes', () => {
  const reflector = new Reflector();

  it('are staff only as whole controllers, so a new route cannot be missed', () => {
    for (const controller of [
      StaffAuthController,
      StaffMeController,
      StaffAdminsController,
      StaffAuditLogController,
      StaffCategoriesController,
    ]) {
      expect([controller.name, reflector.get(STAFF_ONLY, controller)]).toEqual([
        controller.name,
        true,
      ]);
    }
  });

  // New in Part 3B-4; the audit log joined in Part 3B-6.
  it('manage Admins and show the audit log for Super Users only, as whole controllers', () => {
    for (const controller of [StaffAdminsController, StaffAuditLogController]) {
      expect([
        controller.name,
        reflector.get(SUPER_USER_ONLY, controller),
      ]).toEqual([controller.name, true]);
    }
    // Admins manage categories too (Part 4A).
    for (const controller of [
      StaffAuthController,
      StaffMeController,
      StaffCategoriesController,
    ]) {
      expect([
        controller.name,
        reflector.get(SUPER_USER_ONLY, controller),
      ]).toEqual([controller.name, undefined]);
    }
  });

  // Part 4A: of the category routes, only deleting is for Super Users.
  it('let only Super Users delete categories', () => {
    const handlers = StaffCategoriesController.prototype as unknown as Record<
      string,
      () => unknown
    >;
    const superUserOnly = Object.getOwnPropertyNames(handlers).filter(
      (name) =>
        name !== 'constructor' &&
        reflector.get(SUPER_USER_ONLY, handlers[name]) === true,
    );
    expect(superUserOnly).toEqual(['remove']);
  });
});
