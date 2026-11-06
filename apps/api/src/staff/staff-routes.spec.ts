import { Reflector } from '@nestjs/core';
import { STAFF_ONLY } from '../auth/staff-only.decorator';
import { SUPER_USER_ONLY } from '../auth/super-user-only.decorator';
import { StaffCategoriesController } from '../catalog/staff-categories.controller';
import { StaffImagesController } from '../catalog/staff-images.controller';
import { StaffProductsController } from '../catalog/staff-products.controller';
import { StaffVariantsController } from '../catalog/staff-variants.controller';
import { StaffStockController } from '../inventory/staff-stock.controller';
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
      StaffProductsController,
      StaffVariantsController,
      StaffImagesController,
      StaffStockController,
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
    // Admins manage categories (Part 4A), products (Part 4B), their pack
    // sizes and prices (Part 4C), their images (Part 4D), and stock
    // (Part 5) too.
    for (const controller of [
      StaffAuthController,
      StaffMeController,
      StaffCategoriesController,
      StaffProductsController,
      StaffVariantsController,
      StaffImagesController,
      StaffStockController
    ]) {
      expect([
        controller.name,
        reflector.get(SUPER_USER_ONLY, controller),
      ]).toEqual([controller.name, undefined]);
    }
  });

  // Parts 4A to 4C: of the catalog routes, only deleting is for Super Users.
  it('let only Super Users delete categories, products and pack sizes', () => {
    for (const controller of [
      StaffCategoriesController,
      StaffProductsController,
      StaffVariantsController,
    ]) {
      const handlers = controller.prototype as unknown as Record<
        string,
        () => unknown
      >;
      const superUserOnly = Object.getOwnPropertyNames(handlers).filter(
        (name) =>
          name !== 'constructor' &&
          reflector.get(SUPER_USER_ONLY, handlers[name]) === true,
      );
      expect([controller.name, superUserOnly]).toEqual([
        controller.name,
        ['remove'],
      ]);
    }
  });

  // Part 4D: the one exception. Replacing a photo is everyday work, so
  // Admins delete images too (ADR 0023).
  it('let Admins delete images too', () => {
    const handlers = StaffImagesController.prototype as unknown as Record<
      string,
      () => unknown
    >;
    expect(Object.getOwnPropertyNames(handlers)).toContain('remove');
    for (const name of Object.getOwnPropertyNames(handlers)) {
      expect([name, reflector.get(SUPER_USER_ONLY, handlers[name])]).toEqual([
        name,
        undefined,
      ]);
    }
  });
});
