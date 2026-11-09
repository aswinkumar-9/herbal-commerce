import type { AuthUser } from '../auth/auth-user';
import { StaffOrdersController } from './staff-orders.controller';
import type { StaffOrdersService } from './staff-orders.service';

const ORDER_ID = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';

function setup() {
  const orders = {
    list: jest.fn().mockResolvedValue({ orders: [], nextAfter: null }),
    view: jest.fn().mockResolvedValue({ id: ORDER_ID }),
  };
  const controller = new StaffOrdersController(
    orders as unknown as StaffOrdersService,
  );
  return { controller, orders };
}

const staff = (role: AuthUser['role']): AuthUser =>
  ({ id: 'staff-1', sessionId: 'session-1', role }) as AuthUser;

describe('StaffOrdersController', () => {
  it('lists the orders as asked', async () => {
    const { controller, orders } = setup();
    const query = {
      limit: 50,
      after: ORDER_ID,
      status: 'PAID' as const,
      sort: 'oldest' as const,
    };

    await controller.list(query);

    expect(orders.list).toHaveBeenCalledWith(query);
  });

  it("shows a Super User the order's payment, and an Admin none", async () => {
    const { controller, orders } = setup();

    await controller.view(ORDER_ID, staff('SUPER_USER'));
    await controller.view(ORDER_ID, staff('ADMIN'));

    expect(orders.view.mock.calls).toEqual([
      [ORDER_ID, { withPayment: true }],
      [ORDER_ID, { withPayment: false }],
    ]);
  });
});
