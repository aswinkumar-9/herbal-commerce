import { NotFoundException } from '@nestjs/common';
import type { PaymentsService } from '../payments/payments.service';
import type { PrismaService } from '../prisma/prisma.service';
import { StaffOrdersService } from './staff-orders.service';

const ORDER_ID = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
const AFTER = '5a8d3b0f-4c2e-4f9b-8d7a-3e6c9f2b8d41';
const NOW = new Date('2026-11-09T06:00:00.000Z');

const LINE = {
  sku: 'ASH-CAP-60',
  productName: 'Ashwagandha Capsules',
  quantity: 60,
  unit: 'CAPSULES',
  packs: 1,
  mrpRupees: 500,
  priceRupees: 449,
  lineTotalRupees: 449,
  gstRate: 5,
  gstRupees: 21,
  hsnCode: '300490',
};

const ROW = {
  id: ORDER_ID,
  reference: '7KQ2M9XDPA',
  status: 'SHIPPED',
  createdAt: NOW,
  holdExpiresAt: NOW,
  packedAt: NOW,
  shippedAt: NOW,
  courierName: 'Delhivery',
  trackingNumber: '1490811234567',
  deliveredAt: null,
  itemsTotalRupees: 449,
  itemsGstRupees: 21,
  deliveryChargeRupees: 49,
  totalRupees: 498,
  deliveryName: 'Asha K',
  deliveryPhone: '9845012345',
  deliveryLine1: '12, 3rd Cross, Indiranagar',
  deliveryLine2: null,
  deliveryCity: 'Bengaluru',
  deliveryState: 'Karnataka',
  deliveryPincode: '560038',
  items: [LINE],
};

const PAYMENT = {
  razorpayOrderId: 'order_RB58MiP5SPFYyM',
  razorpayPaymentId: 'pay_G3P9vcIhRs3NV4',
  amountRupees: 498,
  paidAt: NOW,
  createdAt: NOW,
  refunds: [],
};

function setup() {
  const prisma = {
    order: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(ROW),
    },
  };
  const payments = {
    staffPaymentFor: jest.fn().mockResolvedValue(PAYMENT),
  };
  const service = new StaffOrdersService(
    prisma as unknown as PrismaService,
    payments as unknown as PaymentsService,
  );
  return { service, prisma, payments };
}

const summary = (id: string) => ({
  id,
  reference: '7KQ2M9XDPA',
  status: 'PAID',
  totalRupees: 498,
  deliveryName: 'Asha K',
  deliveryCity: 'Bengaluru',
  deliveryState: 'Karnataka',
  createdAt: NOW,
});

describe('StaffOrdersService.list', () => {
  it('lists the orders in one status, the oldest first, with the next page', async () => {
    const { service, prisma } = setup();
    prisma.order.findMany.mockResolvedValueOnce([
      summary('o1'),
      summary('o2'),
      summary('o3'),
    ]);

    const page = await service.list({
      limit: 2,
      after: AFTER,
      status: 'PAID',
      sort: 'oldest',
    });

    expect(page).toEqual({
      orders: [summary('o1'), summary('o2')],
      nextAfter: 'o2',
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: { status: 'PAID', reference: undefined },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 3,
      cursor: { id: AFTER },
      skip: 1,
      select: {
        id: true,
        reference: true,
        status: true,
        totalRupees: true,
        deliveryName: true,
        deliveryCity: true,
        deliveryState: true,
        createdAt: true,
      },
    });
  });

  it('lists the newest first by default, from the first page, finds one by its reference, and knows a full last page', async () => {
    const { service, prisma } = setup();
    prisma.order.findMany.mockResolvedValueOnce([summary('o1')]);

    const page = await service.list({
      limit: 1,
      reference: '7KQ2M9XDPA',
      sort: 'newest',
    });

    expect(page.nextAfter).toBeNull();
    const query = prisma.order.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ status: undefined, reference: '7KQ2M9XDPA' });
    expect(query.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(query.take).toBe(2);
    expect(query).not.toHaveProperty('cursor');
    expect(query).not.toHaveProperty('skip');
  });
});

describe('StaffOrdersService.view', () => {
  it('shows an Admin the order with its lines, steps and delivery address, and no payment', async () => {
    const { service, prisma, payments } = setup();

    const view = await service.view(ORDER_ID, { withPayment: false });

    expect(view).toEqual({
      id: ORDER_ID,
      reference: '7KQ2M9XDPA',
      status: 'SHIPPED',
      createdAt: NOW,
      holdExpiresAt: NOW,
      packedAt: NOW,
      shippedAt: NOW,
      courierName: 'Delhivery',
      trackingNumber: '1490811234567',
      deliveredAt: null,
      itemsTotalRupees: 449,
      itemsGstRupees: 21,
      deliveryChargeRupees: 49,
      totalRupees: 498,
      items: [LINE],
      delivery: {
        fullName: 'Asha K',
        phone: '9845012345',
        line1: '12, 3rd Cross, Indiranagar',
        line2: null,
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560038',
      },
    });
    expect(view).not.toHaveProperty('payment');
    expect(payments.staffPaymentFor).not.toHaveBeenCalled();
    const query = prisma.order.findUnique.mock.calls[0][0];
    expect(query.where).toEqual({ id: ORDER_ID });
    expect(query.select.items).toEqual({
      orderBy: { position: 'asc' },
      select: {
        sku: true,
        productName: true,
        quantity: true,
        unit: true,
        packs: true,
        mrpRupees: true,
        priceRupees: true,
        lineTotalRupees: true,
        gstRate: true,
        gstRupees: true,
        hsnCode: true,
      },
    });
    // What staff never see: whose account it is, and the idempotency key.
    expect(query.select).not.toHaveProperty('userId');
    expect(query.select).not.toHaveProperty('idempotencyKey');
  });

  it('adds the payment for a Super User', async () => {
    const { service, payments } = setup();

    const view = await service.view(ORDER_ID, { withPayment: true });

    expect(view.payment).toBe(PAYMENT);
    expect(view.reference).toBe('7KQ2M9XDPA');
    expect(payments.staffPaymentFor).toHaveBeenCalledWith(ORDER_ID);
  });

  it('answers 404 for an unknown order', async () => {
    const { service, prisma, payments } = setup();
    prisma.order.findUnique.mockResolvedValueOnce(null);

    const error = await service
      .view(ORDER_ID, { withPayment: true })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).message).toBe('Order not found');
    expect(payments.staffPaymentFor).not.toHaveBeenCalled();
  });
});
