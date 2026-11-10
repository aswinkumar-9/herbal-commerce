import type { AuditContext } from '../audit/audit-context';
import type { AuthUser } from '../auth/auth-user';
import { StaffOrdersController } from './staff-orders.controller';
import type { StaffOrdersService } from './staff-orders.service';

const ORDER_ID = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
const CONTEXT: AuditContext = {
  actorId: 'staff-1',
  ip: '127.0.0.1',
  requestId: 'req-1',
};

function setup() {
  const orders = {
    list: jest.fn().mockResolvedValue({ orders: [], nextAfter: null }),
    view: jest.fn().mockResolvedValue({ id: ORDER_ID }),
    markPacked: jest.fn().mockResolvedValue({ id: ORDER_ID }),
    markShipped: jest.fn().mockResolvedValue({ id: ORDER_ID }),
    correctShipment: jest.fn().mockResolvedValue({ id: ORDER_ID }),
    markDelivered: jest.fn().mockResolvedValue({ id: ORDER_ID }),
    cancel: jest.fn().mockResolvedValue({ id: ORDER_ID }),
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

  it('takes each step with the audit context, and answers the order as the caller may see it', async () => {
    const { controller, orders } = setup();
    const shipment = {
      courierName: 'Delhivery',
      trackingNumber: '1490811234567',
    };

    await controller.markPacked(ORDER_ID, staff('ADMIN'), CONTEXT);
    await controller.markShipped(ORDER_ID, shipment, staff('ADMIN'), CONTEXT);
    await controller.correctShipment(
      ORDER_ID,
      { trackingNumber: '1490811234568' },
      staff('SUPER_USER'),
      CONTEXT,
    );
    await controller.markDelivered(ORDER_ID, staff('SUPER_USER'), CONTEXT);

    expect(orders.markPacked).toHaveBeenCalledWith(ORDER_ID, CONTEXT, {
      withPayment: false,
    });
    expect(orders.markShipped).toHaveBeenCalledWith(
      ORDER_ID,
      shipment,
      CONTEXT,
      { withPayment: false },
    );
    expect(orders.correctShipment).toHaveBeenCalledWith(
      ORDER_ID,
      { trackingNumber: '1490811234568' },
      CONTEXT,
      { withPayment: true },
    );
    expect(orders.markDelivered).toHaveBeenCalledWith(ORDER_ID, CONTEXT, {
      withPayment: true,
    });
  });

  it('cancels with the audit context, answering a Super User the order with its payment', async () => {
    const { controller, orders } = setup();

    await controller.cancel(ORDER_ID, staff('SUPER_USER'), CONTEXT);

    expect(orders.cancel).toHaveBeenCalledWith(ORDER_ID, CONTEXT, {
      withPayment: true,
    });
  });
});
