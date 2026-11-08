import { BadRequestException } from '@nestjs/common';
import type { OrderPaymentsService } from './order-payments.service';
import { OrdersController } from './orders.controller';
import type { OrdersService } from './orders.service';

const USER = {
  id: 'user-1',
  sessionId: 'session-1',
  role: 'CUSTOMER' as const,
};
const KEY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const body = {
  addressId: '6f2b9d1e-4c7a-4e3b-9a85-1d2c3e4f5a6b',
  totalRupees: 1_546,
};

function setup() {
  const orders = {
    quote: jest.fn().mockResolvedValue({ items: [] }),
    place: jest.fn().mockResolvedValue({ id: 'order-1' }),
    list: jest.fn().mockResolvedValue({ orders: [], nextBefore: null }),
    view: jest.fn().mockResolvedValue({ id: 'order-1' }),
    cancel: jest.fn().mockResolvedValue({ id: 'order-1' }),
  };
  const orderPayments = {
    start: jest.fn().mockResolvedValue({ razorpayOrderId: 'order_A1' }),
  };
  const controller = new OrdersController(
    orders as unknown as OrdersService,
    orderPayments as unknown as OrderPaymentsService,
  );
  return { controller, orders, orderPayments };
}

describe('OrdersController', () => {
  it("prices the caller's own cart, by the ID in the token", async () => {
    const { controller, orders } = setup();

    await expect(controller.quote(USER)).resolves.toEqual({ items: [] });
    expect(orders.quote).toHaveBeenCalledWith('user-1');
  });

  it('places an order for the caller with the Idempotency-Key', async () => {
    const { controller, orders } = setup();

    await expect(controller.place(USER, KEY, body)).resolves.toEqual({
      id: 'order-1',
    });
    expect(orders.place).toHaveBeenCalledWith('user-1', KEY, body);
  });

  it('refuses an order without a UUID as its Idempotency-Key, naming the header', () => {
    const { controller, orders } = setup();

    for (const key of [undefined, 'order-1']) {
      let refusal: unknown;
      try {
        void controller.place(USER, key, body);
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(BadRequestException);
      expect((refusal as BadRequestException).getResponse()).toEqual({
        message: 'Validation failed',
        errors: [
          {
            field: 'Idempotency-Key',
            message:
              'Send an Idempotency-Key header: a new UUID for each order',
          },
        ],
      });
    }
    expect(orders.place).not.toHaveBeenCalled();
  });

  it("lists, shows and cancels the caller's own orders, by the ID in the token", async () => {
    const { controller, orders } = setup();

    await expect(controller.list(USER, { limit: 20 })).resolves.toEqual({
      orders: [],
      nextBefore: null,
    });
    expect(orders.list).toHaveBeenCalledWith('user-1', { limit: 20 });
    await controller.view(USER, 'order-1');
    expect(orders.view).toHaveBeenCalledWith('user-1', 'order-1');
    await controller.cancel(USER, 'order-1');
    expect(orders.cancel).toHaveBeenCalledWith('user-1', 'order-1');
  });

  it("starts paying for the caller's own order, by the ID in the token", async () => {
    const { controller, orderPayments } = setup();

    await expect(controller.pay(USER, 'order-1')).resolves.toEqual({
      razorpayOrderId: 'order_A1',
    });
    expect(orderPayments.start).toHaveBeenCalledWith('user-1', 'order-1');
  });
});
