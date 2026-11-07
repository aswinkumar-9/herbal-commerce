import { Reflector } from '@nestjs/core';
import { AddressesController } from '../addresses/addresses.controller';
import { CartController } from '../cart/cart.controller';
import { CategoriesController } from '../catalog/categories.controller';
import { ProductsController } from '../catalog/products.controller';
import { StaffCategoriesController } from '../catalog/staff-categories.controller';
import { StaffImagesController } from '../catalog/staff-images.controller';
import { StaffStockController } from '../inventory/staff-stock.controller';
import { StaffProductsController } from '../catalog/staff-products.controller';
import { StaffVariantsController } from '../catalog/staff-variants.controller';
import { OrdersController } from '../orders/orders.controller';
import { RATE_LIMIT } from '../rate-limit/rate-limit.decorator';
import { StaffAuthController } from '../staff/staff-auth.controller';
import { StaffAdminsController } from '../staff/staff-admins.controller';
import { StaffAuditLogController } from '../staff/staff-audit-log.controller';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';

// The per-IP limit of each handler, read from its @RateLimit() decorator.
function routeLimits(controller: { prototype: object }) {
  const reflector = new Reflector();
  const handlers = controller.prototype as Record<string, () => unknown>;
  return Object.fromEntries(
    Object.getOwnPropertyNames(handlers)
      .filter((name) => name !== 'constructor')
      .map((name) => [name, reflector.get<string[]>(RATE_LIMIT, handlers[name])]),
  );
}

describe('rate-limited routes', () => {
  it('give every sign-up, sign-in and password reset endpoint its own per-IP limit', () => {
    expect(routeLimits(AuthController)).toEqual({
      register: ['register'],
      verifyEmail: ['verifyEmail'],
      resendVerification: ['resendByIp'],
      login: ['login'],
      refresh: ['refresh'],
      logout: ['logout'],
      forgotPassword: ['forgotPassword'],
      resetPassword: ['resetPassword'],
    });
    expect(routeLimits(StaffAuthController)).toEqual({
      login: ['staffLogin'],
      refresh: ['refresh'],
      logout: ['logout'],
      acceptInvite: ['acceptInvite'],
    });
    // Strict, so a handler without a limit must be listed too.
    expect(routeLimits(StaffAdminsController)).toStrictEqual({
      // Inviting and inviting again send an email, so they share a limit.
      // The others only read or change the database: the per-IP baseline
      // is enough.
      list: undefined,
      invite: ['staffInvites'],
      resendInvitation: ['staffInvites'],
      setStatus: undefined,
      remove: undefined,
    });
    // Reading the audit log has only the per-IP baseline.
    expect(routeLimits(StaffAuditLogController)).toStrictEqual({
      list: undefined,
    });
    // Changing the password checks the current one, so it has its own limit.
    expect(routeLimits(MeController)).toStrictEqual({
      me: undefined,
      update: undefined,
      changePassword: ['changePassword'],
      signOutEverywhere: undefined,
    });
    // At most 10 addresses each, so the per-IP baseline is enough.
    expect(routeLimits(AddressesController)).toStrictEqual({
      list: undefined,
      add: undefined,
      update: undefined,
      remove: undefined,
    });
    // Categories send no email and check no password, so the per-IP
    // baseline is enough, for the public list too.
    expect(routeLimits(StaffCategoriesController)).toStrictEqual({
      list: undefined,
      create: undefined,
      update: undefined,
      remove: undefined,
    });
    expect(routeLimits(CategoriesController)).toStrictEqual({
      list: undefined,
      listProducts: undefined,
    });
    // Products too: small writes and paged reads.
    expect(routeLimits(StaffProductsController)).toStrictEqual({
      list: undefined,
      create: undefined,
      update: undefined,
      remove: undefined,
    });
    expect(routeLimits(ProductsController)).toStrictEqual({
      detail: undefined,
    });
    // Pack sizes too: a few small writes for each product.
    expect(routeLimits(StaffVariantsController)).toStrictEqual({
      list: undefined,
      create: undefined,
      update: undefined,
      remove: undefined,
    });
    // An upload is an image to check and re-encode: it has its own limit.
    expect(routeLimits(StaffImagesController)).toStrictEqual({
      list: undefined,
      create: ['imageUploads'],
      update: undefined,
      remove: undefined,
    });
    // Stock: small writes, each one movement.
    expect(routeLimits(StaffStockController)).toStrictEqual({
      listBatches: undefined,
      receive: undefined,
      updateBatch: undefined,
      listMovements: undefined,
      addMovement: undefined,
    });
    // The cart: small reads and writes, at most 50 lines each.
    expect(routeLimits(CartController)).toStrictEqual({
      view: undefined,
      setPacks: undefined,
      remove: undefined,
      empty: undefined,
    });
    // Placing an order holds stock, so it has its own limit. The checkout
    // only reads.
    expect(routeLimits(OrdersController)).toStrictEqual({
      quote: undefined,
      place: ['placeOrder'],
      list: undefined,
      view: undefined,
      cancel: undefined,
    });
  });
});
