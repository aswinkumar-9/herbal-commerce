import { Reflector } from '@nestjs/core';
import { AddressesController } from '../addresses/addresses.controller';
import { CategoriesController } from '../catalog/categories.controller';
import { ProductsController } from '../catalog/products.controller';
import { StaffCategoriesController } from '../catalog/staff-categories.controller';
import { StaffProductsController } from '../catalog/staff-products.controller';
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
  });
});
