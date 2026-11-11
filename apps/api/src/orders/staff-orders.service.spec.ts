import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PaymentsService } from '../payments/payments.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { OrdersService } from './orders.service';
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

const CONTEXT = { actorId: 'staff-1', ip: '127.0.0.1', requestId: 'req-1' };
const REFUND_ID = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f101';
const ADMIN = { withPayment: false };

function setup() {
  const tx = {
    order: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ status: 'PAID', id: ORDER_ID }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        courierName: 'Delhivery',
        trackingNumber: '1490811234567',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    order: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(ROW),
    },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const payments = {
    staffPaymentFor: jest.fn().mockResolvedValue(PAYMENT),
    requestRefund: jest.fn().mockResolvedValue(undefined),
  };
  const orders = {
    cancelLocked: jest
      .fn()
      .mockResolvedValue({ from: 'PAID', refundId: REFUND_ID }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications = { queue: jest.fn().mockResolvedValue(undefined) };
  const logger = { info: jest.fn() };
  const service = new StaffOrdersService(
    prisma as unknown as PrismaService,
    payments as unknown as PaymentsService,
    orders as unknown as OrdersService,
    audit as unknown as AuditService,
    notifications as unknown as NotificationsService,
    logger as unknown as PinoLogger,
  );
  return {
    service,
    prisma,
    tx,
    payments,
    orders,
    audit,
    notifications,
    logger,
  };
}

// What a refused call throws.
async function refusal(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (error: Error) => error,
  );
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

describe('StaffOrdersService steps', () => {
  it('packs a paid order: the status and its time in one guarded update, audited, and answers the order', async () => {
    const { service, prisma, tx, audit, notifications, logger } = setup();

    const view = await service.markPacked(ORDER_ID, CONTEXT, ADMIN, NOW);

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, status: 'PAID' },
      data: { status: 'PACKED', packedAt: NOW },
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...CONTEXT,
      action: 'order.packed',
      targetType: 'order',
      targetId: ORDER_ID,
      before: { status: 'PAID' },
      after: { status: 'PACKED' },
    });
    expect(notifications.queue).toHaveBeenCalledWith(tx, {
      kind: 'ORDER_PACKED',
      orderId: ORDER_ID,
    });
    expect(logger.info).toHaveBeenCalledWith(
      { orderId: ORDER_ID, actorId: 'staff-1', status: 'PACKED' },
      'Order moved to its next step',
    );
    expect(view.reference).toBe('7KQ2M9XDPA');
    expect(view).not.toHaveProperty('payment');
    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ORDER_ID } }),
    );
  });

  it('ships a packed order with its courier and tracking number, which the audit entry keeps', async () => {
    const { service, tx, audit, notifications } = setup();
    const shipment = {
      courierName: 'Delhivery',
      trackingNumber: '1490811234567',
    };

    await service.markShipped(ORDER_ID, shipment, CONTEXT, ADMIN, NOW);

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, status: 'PACKED' },
      data: { status: 'SHIPPED', shippedAt: NOW, ...shipment },
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...CONTEXT,
      action: 'order.shipped',
      targetType: 'order',
      targetId: ORDER_ID,
      before: { status: 'PACKED' },
      after: { status: 'SHIPPED', ...shipment },
    });
    expect(notifications.queue).toHaveBeenCalledWith(tx, {
      kind: 'ORDER_SHIPPED',
      orderId: ORDER_ID,
    });
  });

  it('marks a shipped order delivered, and shows a Super User its payment', async () => {
    const { service, tx, audit, payments, notifications } = setup();

    const view = await service.markDelivered(
      ORDER_ID,
      CONTEXT,
      { withPayment: true },
      NOW,
    );

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, status: 'SHIPPED' },
      data: { status: 'DELIVERED', deliveredAt: NOW },
    });
    expect(audit.record.mock.calls[0][1]).toMatchObject({
      action: 'order.delivered',
      before: { status: 'SHIPPED' },
      after: { status: 'DELIVERED' },
    });
    expect(view.payment).toBe(PAYMENT);
    expect(payments.staffPaymentFor).toHaveBeenCalledWith(ORDER_ID);
    expect(notifications.queue).toHaveBeenCalledWith(tx, {
      kind: 'ORDER_DELIVERED',
      orderId: ORDER_ID,
    });
  });

  it('refuses a step the order is not ready for, or has taken already (409), and audits nothing', async () => {
    const cases = [
      {
        status: 'PENDING_PAYMENT',
        step: 'markPacked',
        message: 'Only a paid order can be packed.',
      },
      {
        status: 'PACKED',
        step: 'markPacked',
        message: 'This order is packed already.',
      },
      {
        status: 'PAID',
        step: 'markShipped',
        message: 'Only a packed order can be shipped.',
      },
      {
        status: 'SHIPPED',
        step: 'markShipped',
        message: 'This order has shipped already.',
      },
      {
        status: 'PACKED',
        step: 'markDelivered',
        message: 'Only a shipped order can be marked delivered.',
      },
      {
        status: 'DELIVERED',
        step: 'markDelivered',
        message: 'This order is delivered already.',
      },
    ] as const;
    for (const { status, step, message } of cases) {
      const { service, tx, audit, notifications, logger } = setup();
      tx.order.updateMany.mockResolvedValueOnce({ count: 0 });
      tx.order.findUnique.mockResolvedValueOnce({ status, id: ORDER_ID });

      const error =
        step === 'markShipped'
          ? await refusal(
              service.markShipped(
                ORDER_ID,
                { courierName: 'Delhivery', trackingNumber: '1490811234567' },
                CONTEXT,
                ADMIN,
                NOW,
              ),
            )
          : await refusal(service[step](ORDER_ID, CONTEXT, ADMIN, NOW));

      expect([step, status, error]).toEqual([
        step,
        status,
        new ConflictException(message),
      ]);
      expect(audit.record).not.toHaveBeenCalled();
      expect(notifications.queue).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    }
  });

  it('answers 404 for an unknown order', async () => {
    const { service, tx, audit } = setup();
    tx.order.updateMany.mockResolvedValueOnce({ count: 0 });
    tx.order.findUnique.mockResolvedValueOnce(null);

    const error = await refusal(
      service.markPacked(ORDER_ID, CONTEXT, ADMIN, NOW),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('Order not found');
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('StaffOrdersService.cancel', () => {
  it('cancels a paid order for a Super User, audited with its refund, and asks Razorpay after the transaction', async () => {
    const { service, tx, orders, audit, payments, logger } = setup();

    const view = await service.cancel(
      ORDER_ID,
      CONTEXT,
      { withPayment: true },
      NOW,
    );

    expect(orders.cancelLocked).toHaveBeenCalledWith(
      tx,
      { id: ORDER_ID },
      'CANCELLED_BY_STAFF',
      NOW,
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...CONTEXT,
      action: 'order.cancelled',
      targetType: 'order',
      targetId: ORDER_ID,
      before: { status: 'PAID' },
      after: { status: 'CANCELLED', refundId: REFUND_ID },
    });
    expect(payments.requestRefund).toHaveBeenCalledWith(REFUND_ID);
    expect(
      audit.record.mock.invocationCallOrder[0] <
        payments.requestRefund.mock.invocationCallOrder[0],
    ).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      { orderId: ORDER_ID, actorId: 'staff-1', from: 'PAID' },
      'Order cancelled by staff',
    );
    expect(view.payment).toBe(PAYMENT);
  });

  it('cancels an unpaid order without a refund', async () => {
    const { service, orders, audit, payments } = setup();
    orders.cancelLocked.mockResolvedValueOnce({
      from: 'PENDING_PAYMENT',
      refundId: null,
    });

    await service.cancel(ORDER_ID, CONTEXT, ADMIN, NOW);

    expect(audit.record.mock.calls[0][1]).toMatchObject({
      before: { status: 'PENDING_PAYMENT' },
      after: { status: 'CANCELLED', refundId: null },
    });
    expect(payments.requestRefund).not.toHaveBeenCalled();
  });

  it('audits, refunds and logs nothing when the order cannot be cancelled', async () => {
    const { service, orders, audit, payments, logger } = setup();
    orders.cancelLocked.mockRejectedValueOnce(
      new ConflictException('This order can no longer be cancelled.'),
    );

    const error = await refusal(service.cancel(ORDER_ID, CONTEXT, ADMIN, NOW));

    expect(error).toEqual(
      new ConflictException('This order can no longer be cancelled.'),
    );
    expect(audit.record).not.toHaveBeenCalled();
    expect(payments.requestRefund).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('StaffOrdersService.correctShipment', () => {
  it('locks the order on its way, changes only what differs, audits it, and tells the customer', async () => {
    const { service, tx, audit, notifications, logger } = setup();

    const view = await service.correctShipment(
      ORDER_ID,
      { courierName: 'Delhivery', trackingNumber: '1490811234568' },
      CONTEXT,
      ADMIN,
      NOW,
    );

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: ORDER_ID, status: 'SHIPPED' },
      data: { updatedAt: NOW },
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: { trackingNumber: '1490811234568' },
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...CONTEXT,
      action: 'order.shipment_corrected',
      targetType: 'order',
      targetId: ORDER_ID,
      before: { trackingNumber: '1490811234567' },
      after: { trackingNumber: '1490811234568' },
    });
    expect(notifications.queue).toHaveBeenCalledWith(tx, {
      kind: 'SHIPMENT_CORRECTED',
      orderId: ORDER_ID,
    });
    expect(logger.info).toHaveBeenCalledWith(
      { orderId: ORDER_ID, actorId: 'staff-1' },
      'Order shipment corrected',
    );
    expect(view.reference).toBe('7KQ2M9XDPA');
  });

  it('corrects the courier alone too, leaving the tracking number out of the change and its audit entry', async () => {
    const { service, tx, audit } = setup();

    await service.correctShipment(
      ORDER_ID,
      { courierName: 'Blue Dart' },
      CONTEXT,
      ADMIN,
      NOW,
    );

    // Strict: a field sent as undefined would count as present.
    expect(tx.order.update.mock.calls[0][0]).toStrictEqual({
      where: { id: ORDER_ID },
      data: { courierName: 'Blue Dart' },
    });
    expect(audit.record.mock.calls[0][1].before).toStrictEqual({
      courierName: 'Delhivery',
    });
    expect(audit.record.mock.calls[0][1].after).toStrictEqual({
      courierName: 'Blue Dart',
    });
  });

  it('changes nothing, audits nothing and tells nobody, when the values are the same', async () => {
    const { service, tx, audit, notifications, logger } = setup();

    const view = await service.correctShipment(
      ORDER_ID,
      { courierName: 'Delhivery', trackingNumber: '1490811234567' },
      CONTEXT,
      ADMIN,
      NOW,
    );

    expect(tx.order.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.queue).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    expect(view.reference).toBe('7KQ2M9XDPA');
  });

  it('refuses an order that is not on its way (409), and an unknown one (404)', async () => {
    const { service, tx, audit, notifications } = setup();
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    tx.order.findUnique.mockResolvedValueOnce({ id: ORDER_ID });

    const notShipped = await refusal(
      service.correctShipment(
        ORDER_ID,
        { courierName: 'Blue Dart' },
        CONTEXT,
        ADMIN,
        NOW,
      ),
    );
    expect(notShipped).toEqual(
      new ConflictException(
        'Only an order on its way can have its courier or tracking number corrected.',
      ),
    );

    tx.order.findUnique.mockResolvedValueOnce(null);
    const unknown = await refusal(
      service.correctShipment(
        ORDER_ID,
        { courierName: 'Blue Dart' },
        CONTEXT,
        ADMIN,
        NOW,
      ),
    );
    expect(unknown).toBeInstanceOf(NotFoundException);
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.queue).not.toHaveBeenCalled();
  });
});
