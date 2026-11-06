import { Reflector } from '@nestjs/core';
import { HealthController } from '../health/health.controller';
import { AddressesController } from '../addresses/addresses.controller';
import { CartController } from '../cart/cart.controller';
import { CategoriesController } from '../catalog/categories.controller';
import { ProductsController } from '../catalog/products.controller';
import { StaffCategoriesController } from '../catalog/staff-categories.controller';
import { StaffImagesController } from '../catalog/staff-images.controller';
import { StaffStockController } from '../inventory/staff-stock.controller';
import { StaffProductsController } from '../catalog/staff-products.controller';
import { StaffVariantsController } from '../catalog/staff-variants.controller';
import { StaffAdminsController } from '../staff/staff-admins.controller';
import { StaffAuditLogController } from '../staff/staff-audit-log.controller';
import { StaffAuthController } from '../staff/staff-auth.controller';
import { StaffMeController } from '../staff/staff-me.controller';
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
  it('are exactly the sign-up, sign-in, password reset, invitation, health and shop endpoints', () => {
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
    expect(publicHandlers(StaffAuthController)).toEqual([
      'login',
      'refresh',
      'logout',
      'acceptInvite',
    ]);
    expect(publicHandlers(StaffMeController)).toEqual([]);
    expect(publicHandlers(StaffAdminsController)).toEqual([]);
    expect(publicHandlers(StaffAuditLogController)).toEqual([]);
    expect(publicHandlers(AddressesController)).toEqual([]);
    expect(publicHandlers(StaffCategoriesController)).toEqual([]);
    expect(publicHandlers(StaffProductsController)).toEqual([]);
    expect(publicHandlers(StaffVariantsController)).toEqual([]);
    expect(publicHandlers(StaffImagesController)).toEqual([]);
    expect(publicHandlers(StaffStockController)).toEqual([]);
    // Part 6: a cart belongs to a signed-in customer.
    expect(publicHandlers(CartController)).toEqual([]);
    // Parts 4A and 4B: customers browse the shop before they sign in.
    expect(publicHandlers(CategoriesController)).toEqual([
      'list',
      'listProducts',
    ]);
    expect(publicHandlers(ProductsController)).toEqual(['detail']);
  });
});
