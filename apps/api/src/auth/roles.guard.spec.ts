import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public } from './public.decorator';
import { RolesGuard } from './roles.guard';
import { STAFF_ONLY, StaffOnly } from './staff-only.decorator';
import { SuperUserOnly } from './super-user-only.decorator';

// Stand-ins for real controllers, decorated the way real ones are.
class CustomerRoutes {
  me() {}
}

@StaffOnly()
class StaffRoutes {
  forAllStaff() {}

  @SuperUserOnly()
  forSuperUsers() {}
}

@SuperUserOnly()
class SuperUserRoutes {
  anything() {}

  @Public()
  open() {}
}

type Controller = { prototype: object };

// The guard with the real Reflector, and a caller of this role, if any.
function setup(controller: Controller, handler: string, role?: string) {
  const request = {
    user: role ? { id: 'user-1', sessionId: 'session-1', role } : undefined,
  };
  const context = {
    getHandler: () =>
      (controller.prototype as Record<string, unknown>)[handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard: new RolesGuard(new Reflector()), context };
}

describe('RolesGuard', () => {
  it('leaves every route alone that is not @SuperUserOnly()', () => {
    const routes: [Controller, string, string][] = [
      [CustomerRoutes, 'me', 'CUSTOMER'],
      [StaffRoutes, 'forAllStaff', 'ADMIN'],
      [StaffRoutes, 'forAllStaff', 'SUPER_USER'],
    ];
    for (const [controller, handler, role] of routes) {
      const { guard, context } = setup(controller, handler, role);

      expect(guard.canActivate(context)).toBe(true);
    }
  });

  it('lets a Super User through, on a marked handler or a marked controller', () => {
    const routes: [Controller, string][] = [
      [StaffRoutes, 'forSuperUsers'],
      [SuperUserRoutes, 'anything'],
    ];
    for (const [controller, handler] of routes) {
      const { guard, context } = setup(controller, handler, 'SUPER_USER');

      expect(guard.canActivate(context)).toBe(true);
    }
  });

  it('refuses an Admin with 403', () => {
    const routes: [Controller, string][] = [
      [StaffRoutes, 'forSuperUsers'],
      [SuperUserRoutes, 'anything'],
    ];
    for (const [controller, handler] of routes) {
      const { guard, context } = setup(controller, handler, 'ADMIN');

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    }
  });

  it('fails closed: no checked caller means no entry, even on a @Public() handler', () => {
    const { guard, context } = setup(SuperUserRoutes, 'open');

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('makes every @SuperUserOnly() route a staff route too', () => {
    const reflector = new Reflector();
    const handlers = StaffRoutes.prototype as unknown as Record<
      string,
      () => void
    >;

    expect(reflector.get(STAFF_ONLY, handlers.forSuperUsers)).toBe(true);
    expect(reflector.get(STAFF_ONLY, SuperUserRoutes)).toBe(true);
  });
});
