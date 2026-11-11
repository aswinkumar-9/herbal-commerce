import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { RetryLaterException } from '../common/retry-later.exception';
import {
  NotEnoughStockError,
  type StockService,
} from '../inventory/stock.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PaymentsService } from '../payments/payments.service';
import { RazorpayError } from '../payments/razorpay.gateway';
import type { PrismaService } from '../prisma/prisma.service';
import { OrderPaymentsService } from './order-payments.service';
import type { OrdersService } from './orders.service';

const USER = 'user-1';
const ORDER_ID = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
const PAYMENT_ID = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a101';
const REFUND_ID = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f101';
const NOW = new Date('2026-11-08T06:00:00.000Z');
const HOLD = new Date('2026-11-08T06:10:00.000Z');

const order = {
  id: ORDER_ID,
  reference: '7KQ2M9XDPA',
  status: 'PENDING_PAYMENT',
  totalRupees: 498,
  holdExpiresAt: HOLD,
};
const captured = {
  id: 'pay_G3P9vcIhRs3NV4',
  orderId: 'order_Captured01',
  amountRupees: 498,
  refundedRupees: 0,
  currency: 'INR',
  status: 'captured' as const,
  method: 'upi',
};
const record = { id: PAYMENT_ID, orderId: ORDER_ID, amountRupees: 498 };
const items = [{ variantId: 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', packs: 1 }];

function setup() {
  const tx = {
    order: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ status: 'PENDING_PAYMENT', items }),
    },
  };
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const payments = {
    keyId: 'rzp_test_FakeKey0123',
    razorpayOrderFor: jest.fn().mockResolvedValue('order_RB58MiP5SPFYyM'),
    razorpayOrderOf: jest.fn().mockResolvedValue('order_Captured01'),
    isCheckoutSignatureValid: jest.fn().mockReturnValue(true),
    razorpayPayment: jest.fn().mockResolvedValue(captured),
    forRazorpayOrder: jest.fn().mockResolvedValue(record),
    settlementState: jest
      .fn()
      .mockResolvedValue({ paidBy: null, refunded: false }),
    markPaid: jest.fn().mockResolvedValue(undefined),
    recordRefund: jest.fn().mockResolvedValue(REFUND_ID),
    requestRefund: jest.fn().mockResolvedValue(undefined),
    razorpayOrdersOf: jest.fn().mockResolvedValue([]),
    capturedPaymentsOf: jest.fn().mockResolvedValue([]),
  };
  const stock = { take: jest.fn().mockResolvedValue(undefined) };
  const orders = {
    view: jest.fn().mockResolvedValue({ id: ORDER_ID, status: 'PAID' }),
  };
  const notifications = { queue: jest.fn().mockResolvedValue(undefined) };
  const logger = { error: jest.fn(), warn: jest.fn() };
  const service = new OrderPaymentsService(
    prisma as unknown as PrismaService,
    payments as unknown as PaymentsService,
    stock as unknown as StockService,
    orders as unknown as OrdersService,
    notifications as unknown as NotificationsService,
    logger as unknown as PinoLogger,
  );
  return {
    service,
    prisma,
    tx,
    payments,
    stock,
    orders,
    notifications,
    logger,
  };
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}

describe('OrderPaymentsService.start', () => {
  it("answers what the app needs for Razorpay's page, in rupees", async () => {
    const { service, prisma, payments } = setup();

    await expect(service.start(USER, ORDER_ID, NOW)).resolves.toEqual({
      reference: '7KQ2M9XDPA',
      totalRupees: 498,
      holdExpiresAt: HOLD,
      razorpayKeyId: 'rzp_test_FakeKey0123',
      razorpayOrderId: 'order_RB58MiP5SPFYyM',
    });
    expect(prisma.order.findFirst).toHaveBeenCalledWith({
      where: { id: ORDER_ID, userId: USER },
      select: {
        id: true,
        reference: true,
        status: true,
        totalRupees: true,
        holdExpiresAt: true,
      },
    });
    expect(payments.razorpayOrderFor).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      reference: '7KQ2M9XDPA',
      amountRupees: 498,
    });
  });

  it("answers 404 for an unknown order, or someone else's", async () => {
    const { service, prisma, payments } = setup();
    prisma.order.findFirst.mockResolvedValueOnce(null);

    const error = await refusal(service.start(USER, ORDER_ID, NOW));

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).message).toBe('Order not found');
    expect(payments.razorpayOrderFor).not.toHaveBeenCalled();
  });

  it('refuses an order that is not waiting for payment', async () => {
    for (const status of ['PAID', 'CANCELLED', 'EXPIRED']) {
      const { service, prisma, payments } = setup();
      prisma.order.findFirst.mockResolvedValueOnce({ ...order, status });

      const error = await refusal(service.start(USER, ORDER_ID, NOW));

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        'Only an order waiting for payment can be paid.',
      );
      expect(payments.razorpayOrderFor).not.toHaveBeenCalled();
    }
  });

  it('refuses an order whose hold is over, even before the job expires it', async () => {
    for (const now of [HOLD, new Date(HOLD.getTime() + 1)]) {
      const { service, payments } = setup();

      const error = await refusal(service.start(USER, ORDER_ID, now));

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        'The time to pay for this order is over. Please order again.',
      );
      expect(payments.razorpayOrderFor).not.toHaveBeenCalled();
    }
  });

  it('starts a payment until the last moment of the hold', async () => {
    const { service } = setup();

    await expect(
      service.start(USER, ORDER_ID, new Date(HOLD.getTime() - 1)),
    ).resolves.toMatchObject({ razorpayOrderId: 'order_RB58MiP5SPFYyM' });
  });

  it('asks to try again later when Razorpay fails, and logs only its status and code', async () => {
    const { service, payments, logger } = setup();
    payments.razorpayOrderFor.mockRejectedValueOnce(
      new RazorpayError(401, 'BAD_REQUEST_ERROR', 'Authentication failed'),
    );

    const error = await refusal(service.start(USER, ORDER_ID, NOW));

    expect(error).toBeInstanceOf(RetryLaterException);
    const busy = error as RetryLaterException;
    expect(busy.getStatus()).toBe(503);
    expect(busy.getResponse()).toEqual({
      message:
        'Payments are not available right now. Please try again in a minute.',
      code: 'PAYMENTS_UNAVAILABLE',
    });
    expect(busy.retryAfterSeconds).toBe(30);
    expect(logger.error).toHaveBeenCalledWith(
      { status: 401, code: 'BAD_REQUEST_ERROR' },
      'Razorpay could not start a payment',
    );
  });

  it('refuses an order cancelled or expired while its payment was made', async () => {
    const { service, prisma, payments } = setup();
    payments.razorpayOrderFor.mockRejectedValueOnce(
      new Error('a payment is for an order waiting for payment'),
    );
    prisma.order.findFirst
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce({ status: 'EXPIRED' });

    const error = await refusal(service.start(USER, ORDER_ID, NOW));

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe(
      'Only an order waiting for payment can be paid.',
    );
    expect(prisma.order.findFirst).toHaveBeenLastCalledWith({
      where: { id: ORDER_ID, userId: USER },
      select: { status: true },
    });
  });

  it('passes on any other failure while the order still waits', async () => {
    const { service, prisma, payments } = setup();
    const failure = new Error('the database is down');
    payments.razorpayOrderFor.mockRejectedValueOnce(failure);
    prisma.order.findFirst
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce({ status: 'PENDING_PAYMENT' });

    await expect(service.start(USER, ORDER_ID, NOW)).rejects.toBe(failure);
  });
});

describe('OrderPaymentsService.confirm', () => {
  const confirmation = {
    razorpayPaymentId: captured.id,
    razorpaySignature: 'a'.repeat(64),
  };

  it("checks Razorpay's signature for this order's Razorpay order, settles on Razorpay's word, and answers the order", async () => {
    const { service, prisma, payments, orders } = setup();

    await expect(
      service.confirm(USER, ORDER_ID, confirmation),
    ).resolves.toEqual({ id: ORDER_ID, status: 'PAID' });
    expect(prisma.order.findFirst).toHaveBeenCalledWith({
      where: { id: ORDER_ID, userId: USER },
      select: { id: true },
    });
    expect(payments.razorpayOrderOf).toHaveBeenCalledWith(ORDER_ID);
    expect(payments.isCheckoutSignatureValid).toHaveBeenCalledWith(
      'order_Captured01',
      captured.id,
      'a'.repeat(64),
    );
    expect(payments.razorpayPayment).toHaveBeenCalledWith(captured.id);
    expect(payments.markPaid).toHaveBeenCalled();
    expect(orders.view).toHaveBeenCalledWith(USER, ORDER_ID);
    expect(
      payments.markPaid.mock.invocationCallOrder[0] <
        orders.view.mock.invocationCallOrder[0],
    ).toBe(true);
  });

  it("answers 404 for an unknown order, or someone else's", async () => {
    const { service, prisma, payments } = setup();
    prisma.order.findFirst.mockResolvedValueOnce(null);

    const error = await refusal(service.confirm(USER, ORDER_ID, confirmation));

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).message).toBe('Order not found');
    expect(payments.razorpayOrderOf).not.toHaveBeenCalled();
  });

  it('refuses an order whose payment was never started', async () => {
    const { service, payments } = setup();
    payments.razorpayOrderOf.mockResolvedValueOnce(null);

    const error = await refusal(service.confirm(USER, ORDER_ID, confirmation));

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe(
      'Start paying for this order first.',
    );
    expect(payments.isCheckoutSignatureValid).not.toHaveBeenCalled();
  });

  it('refuses a wrong signature without asking Razorpay, and logs only the order', async () => {
    const { service, payments, orders, logger } = setup();
    payments.isCheckoutSignatureValid.mockReturnValueOnce(false);

    const error = await refusal(service.confirm(USER, ORDER_ID, confirmation));

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(
      'The payment could not be verified.',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { orderId: ORDER_ID },
      'A payment came with a wrong signature',
    );
    expect(payments.razorpayPayment).not.toHaveBeenCalled();
    expect(orders.view).not.toHaveBeenCalled();
  });

  it('answers the order as it is while the payment is not captured', async () => {
    const { service, prisma, payments, orders } = setup();
    payments.razorpayPayment.mockResolvedValueOnce({
      ...captured,
      status: 'authorized',
    });

    await service.confirm(USER, ORDER_ID, confirmation);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(orders.view).toHaveBeenCalledWith(USER, ORDER_ID);
  });

  it('asks to try again later when Razorpay fails, and logs only its status and code', async () => {
    const { service, payments, orders, logger } = setup();
    payments.razorpayPayment.mockRejectedValueOnce(
      new RazorpayError(null, null, 'Razorpay could not be reached'),
    );

    const error = await refusal(service.confirm(USER, ORDER_ID, confirmation));

    expect(error).toBeInstanceOf(RetryLaterException);
    const busy = error as RetryLaterException;
    expect([busy.getStatus(), busy.retryAfterSeconds]).toEqual([503, 30]);
    expect(busy.getResponse()).toEqual({
      message:
        'Payments are not available right now. Please try again in a minute.',
      code: 'PAYMENTS_UNAVAILABLE',
    });
    expect(logger.error).toHaveBeenCalledWith(
      { status: null, code: null },
      'Razorpay could not confirm a payment',
    );
    expect(orders.view).not.toHaveBeenCalled();
  });

  it('passes on any other failure', async () => {
    const { service, payments } = setup();
    payments.razorpayPayment.mockResolvedValueOnce({
      ...captured,
      amountRupees: 1,
    });

    await expect(service.confirm(USER, ORDER_ID, confirmation)).rejects.toThrow(
      'A captured payment does not match its order',
    );
  });

  it('refuses a payment that settles another order, or none of ours', async () => {
    const { service, payments, orders } = setup();
    payments.forRazorpayOrder.mockResolvedValueOnce({
      ...record,
      orderId: 'another-order',
    });

    const other = await refusal(service.confirm(USER, ORDER_ID, confirmation));
    expect(other).toBeInstanceOf(BadRequestException);

    payments.forRazorpayOrder.mockResolvedValueOnce(null);
    const unknown = await refusal(
      service.confirm(USER, ORDER_ID, confirmation),
    );
    expect(unknown).toBeInstanceOf(BadRequestException);
    expect((unknown as BadRequestException).message).toBe(
      'The payment could not be verified.',
    );
    expect(orders.view).not.toHaveBeenCalled();
  });
});

describe('OrderPaymentsService.settle', () => {
  it('pays an order waiting for payment: the order locked first, the payment before the order', async () => {
    const { service, prisma, tx, payments, stock, notifications } = setup();

    await expect(service.settle(captured.id, NOW)).resolves.toEqual({
      kind: 'PAID',
      orderId: ORDER_ID,
      late: false,
    });
    expect(payments.razorpayPayment).toHaveBeenCalledWith(captured.id);
    expect(payments.forRazorpayOrder).toHaveBeenCalledWith('order_Captured01');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.order.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: ORDER_ID },
      data: { updatedAt: NOW },
    });
    expect(tx.order.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      select: {
        status: true,
        items: {
          orderBy: { position: 'asc' },
          select: { variantId: true, packs: true },
        },
      },
    });
    expect(payments.settlementState).toHaveBeenCalledWith(
      tx,
      PAYMENT_ID,
      captured.id,
    );
    expect(payments.markPaid).toHaveBeenCalledWith(
      tx,
      PAYMENT_ID,
      captured.id,
      NOW,
    );
    expect(tx.order.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: ORDER_ID, status: 'PENDING_PAYMENT' },
      data: { status: 'PAID' },
    });
    // The lock comes first, the payment is paid before the order.
    const lock = tx.order.updateMany.mock.invocationCallOrder[0];
    const read = tx.order.findUniqueOrThrow.mock.invocationCallOrder[0];
    const paid = payments.markPaid.mock.invocationCallOrder[0];
    const orderPaid = tx.order.updateMany.mock.invocationCallOrder[1];
    expect(lock < read && read < paid && paid < orderPaid).toBe(true);
    // Then the email that tells the customer, in the same transaction.
    expect(notifications.queue).toHaveBeenCalledWith(tx, {
      kind: 'ORDER_PAID',
      orderId: ORDER_ID,
    });
    expect(orderPaid < notifications.queue.mock.invocationCallOrder[0]).toBe(
      true,
    );
    expect(stock.take).not.toHaveBeenCalled();
    expect(payments.recordRefund).not.toHaveBeenCalled();
    expect(payments.requestRefund).not.toHaveBeenCalled();
  });

  it('changes nothing for a payment that is not captured', async () => {
    for (const status of [
      'created',
      'authorized',
      'failed',
      'refunded',
    ] as const) {
      const { service, prisma, payments } = setup();
      payments.razorpayPayment.mockResolvedValueOnce({ ...captured, status });

      await expect(service.settle(captured.id, NOW)).resolves.toEqual({
        kind: 'NOT_CAPTURED',
        razorpayStatus: status,
      });
      expect(payments.forRazorpayOrder).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('changes nothing for a payment that is not for one of our orders', async () => {
    const { service, prisma, payments } = setup();
    payments.razorpayPayment.mockResolvedValueOnce({
      ...captured,
      orderId: null,
    });

    await expect(service.settle(captured.id, NOW)).resolves.toEqual({
      kind: 'UNKNOWN_ORDER',
    });
    expect(payments.forRazorpayOrder).not.toHaveBeenCalled();

    payments.forRazorpayOrder.mockResolvedValueOnce(null);
    await expect(service.settle(captured.id, NOW)).resolves.toEqual({
      kind: 'UNKNOWN_ORDER',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('decides nothing for a captured payment of another amount or currency', async () => {
    for (const other of [
      { amountRupees: 497 },
      { amountRupees: null },
      { currency: 'USD' },
    ]) {
      const { service, prisma, payments } = setup();
      payments.razorpayPayment.mockResolvedValueOnce({
        ...captured,
        ...other,
      });

      await expect(service.settle(captured.id, NOW)).rejects.toThrow(
        'A captured payment does not match its order',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('changes nothing when the same payment is settled again', async () => {
    for (const state of [
      { paidBy: captured.id, refunded: false },
      { paidBy: null, refunded: true },
      { paidBy: 'pay_Other0000001', refunded: true },
    ]) {
      const { service, tx, payments, stock } = setup();
      payments.settlementState.mockResolvedValueOnce(state);

      await expect(service.settle(captured.id, NOW)).resolves.toEqual({
        kind: 'ALREADY_SETTLED',
        orderId: ORDER_ID,
      });
      expect(payments.markPaid).not.toHaveBeenCalled();
      expect(payments.recordRefund).not.toHaveBeenCalled();
      expect(stock.take).not.toHaveBeenCalled();
      // Only the lock touched the order.
      expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
    }
  });

  it('pays an expired order late when its stock can be taken again', async () => {
    const { service, tx, payments, stock, notifications } = setup();
    tx.order.findUniqueOrThrow.mockResolvedValueOnce({
      status: 'EXPIRED',
      items,
    });

    await expect(service.settle(captured.id, NOW)).resolves.toEqual({
      kind: 'PAID',
      orderId: ORDER_ID,
      late: true,
    });
    expect(stock.take).toHaveBeenCalledWith(tx, ORDER_ID, items, NOW);
    expect(payments.markPaid).toHaveBeenCalledWith(
      tx,
      PAYMENT_ID,
      captured.id,
      NOW,
    );
    expect(tx.order.updateMany).toHaveBeenLastCalledWith({
      where: { id: ORDER_ID, status: 'EXPIRED' },
      data: { status: 'PAID' },
    });
    expect(
      stock.take.mock.invocationCallOrder[0] <
        payments.markPaid.mock.invocationCallOrder[0],
    ).toBe(true);
    expect(payments.recordRefund).not.toHaveBeenCalled();
    expect(notifications.queue).toHaveBeenCalledWith(tx, {
      kind: 'ORDER_PAID',
      orderId: ORDER_ID,
    });
  });

  it('gives a late payment back in full when the stock is gone, and asks Razorpay only after saving', async () => {
    const { service, prisma, tx, payments, stock, notifications } = setup();
    tx.order.findUniqueOrThrow.mockResolvedValueOnce({
      status: 'EXPIRED',
      items,
    });
    stock.take.mockRejectedValueOnce(
      new NotEnoughStockError(items[0].variantId),
    );

    await expect(service.settle(captured.id, NOW)).resolves.toEqual({
      kind: 'REFUNDING',
      orderId: ORDER_ID,
      reason: 'ORDER_EXPIRED',
      refundId: REFUND_ID,
    });
    expect(payments.recordRefund).toHaveBeenCalledWith(tx, {
      paymentId: PAYMENT_ID,
      razorpayPaymentId: captured.id,
      amountRupees: 498,
      reason: 'ORDER_EXPIRED',
    });
    expect(payments.markPaid).not.toHaveBeenCalled();
    expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
    // No email for a payment given back (the owner's choice, ADR 0029).
    expect(notifications.queue).not.toHaveBeenCalled();
    expect(payments.requestRefund).toHaveBeenCalledWith(REFUND_ID);
    const saved = await prisma.$transaction.mock.results[0].value;
    expect(saved).toMatchObject({ kind: 'REFUNDING' });
    expect(
      payments.recordRefund.mock.invocationCallOrder[0] <
        payments.requestRefund.mock.invocationCallOrder[0],
    ).toBe(true);
  });

  it('gives back a payment for a cancelled order, without taking stock', async () => {
    const { service, tx, payments, stock } = setup();
    tx.order.findUniqueOrThrow.mockResolvedValueOnce({
      status: 'CANCELLED',
      items,
    });

    await expect(service.settle(captured.id, NOW)).resolves.toEqual({
      kind: 'REFUNDING',
      orderId: ORDER_ID,
      reason: 'ORDER_CANCELLED',
      refundId: REFUND_ID,
    });
    expect(stock.take).not.toHaveBeenCalled();
    expect(payments.markPaid).not.toHaveBeenCalled();
    expect(payments.requestRefund).toHaveBeenCalledWith(REFUND_ID);
  });

  it('gives back a second payment for an order already paid', async () => {
    const { service, tx, payments } = setup();
    tx.order.findUniqueOrThrow.mockResolvedValueOnce({ status: 'PAID', items });
    payments.settlementState.mockResolvedValueOnce({
      paidBy: 'pay_First000001',
      refunded: false,
    });

    await expect(service.settle(captured.id, NOW)).resolves.toEqual({
      kind: 'REFUNDING',
      orderId: ORDER_ID,
      reason: 'ALREADY_PAID',
      refundId: REFUND_ID,
    });
    expect(payments.recordRefund).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ reason: 'ALREADY_PAID' }),
    );
    expect(payments.markPaid).not.toHaveBeenCalled();
  });

  it('never pays a payment twice: a second payment goes back even while the order shows as waiting', async () => {
    const { service, tx, payments } = setup();
    payments.settlementState.mockResolvedValueOnce({
      paidBy: 'pay_First000001',
      refunded: false,
    });

    await expect(service.settle(captured.id, NOW)).resolves.toMatchObject({
      kind: 'REFUNDING',
      reason: 'ALREADY_PAID',
    });
    expect(payments.markPaid).not.toHaveBeenCalled();
    expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
  });

  it('gives back a payment for a paid order whose payment shows no payer, as already paid', async () => {
    const { service, tx } = setup();
    tx.order.findUniqueOrThrow.mockResolvedValueOnce({ status: 'PAID', items });

    await expect(service.settle(captured.id, NOW)).resolves.toMatchObject({
      kind: 'REFUNDING',
      reason: 'ALREADY_PAID',
    });
  });

  it('passes on any other failure while taking stock again, and records no refund', async () => {
    const { service, tx, payments, stock } = setup();
    tx.order.findUniqueOrThrow.mockResolvedValueOnce({
      status: 'EXPIRED',
      items,
    });
    const failure = new Error('the database is down');
    stock.take.mockRejectedValueOnce(failure);

    await expect(service.settle(captured.id, NOW)).rejects.toBe(failure);
    expect(payments.recordRefund).not.toHaveBeenCalled();
    expect(payments.requestRefund).not.toHaveBeenCalled();
  });

  it('fails when the order changed although it was locked, and saves no email', async () => {
    const { service, tx, notifications } = setup();
    tx.order.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(service.settle(captured.id, NOW)).rejects.toThrow(
      'The order changed while it was locked',
    );
    expect(notifications.queue).not.toHaveBeenCalled();
  });

  it("passes Razorpay's failure on, before deciding anything", async () => {
    const { service, prisma, payments } = setup();
    const failure = new RazorpayError(
      null,
      null,
      'Razorpay could not be reached',
    );
    payments.razorpayPayment.mockRejectedValueOnce(failure);

    await expect(service.settle(captured.id, NOW)).rejects.toBe(failure);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('OrderPaymentsService.collectDuePayments', () => {
  it('asks nothing when no order is due', async () => {
    const { service, prisma, payments } = setup();

    await expect(service.collectDuePayments(NOW)).resolves.toEqual({
      settled: 0,
      failed: 0,
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lte: NOW } },
      orderBy: { holdExpiresAt: 'asc' },
      take: 100,
      select: { id: true },
    });
    expect(payments.razorpayOrdersOf).not.toHaveBeenCalled();
  });

  it('settles each payment Razorpay captured for a due order that started paying', async () => {
    const { service, prisma, payments } = setup();
    prisma.order.findMany.mockResolvedValueOnce([
      { id: ORDER_ID },
      { id: 'never-paying' },
    ]);
    payments.razorpayOrdersOf.mockResolvedValueOnce([
      { orderId: ORDER_ID, razorpayOrderId: 'order_Captured01' },
    ]);
    payments.capturedPaymentsOf.mockResolvedValueOnce([captured.id]);
    const settle = jest
      .spyOn(service, 'settle')
      .mockResolvedValue({ kind: 'PAID', orderId: ORDER_ID, late: false });

    await expect(service.collectDuePayments(NOW)).resolves.toEqual({
      settled: 1,
      failed: 0,
    });
    expect(payments.razorpayOrdersOf).toHaveBeenCalledWith([
      ORDER_ID,
      'never-paying',
    ]);
    expect(payments.capturedPaymentsOf).toHaveBeenCalledWith(
      'order_Captured01',
    );
    expect(settle).toHaveBeenCalledWith(captured.id, NOW);
  });

  it('counts an order Razorpay cannot be asked about, and goes on with the others', async () => {
    const { service, prisma, payments } = setup();
    prisma.order.findMany.mockResolvedValueOnce([
      { id: ORDER_ID },
      { id: 'second-order' },
    ]);
    payments.razorpayOrdersOf.mockResolvedValueOnce([
      { orderId: ORDER_ID, razorpayOrderId: 'order_Captured01' },
      { orderId: 'second-order', razorpayOrderId: 'order_Second0001' },
    ]);
    payments.capturedPaymentsOf
      .mockRejectedValueOnce(
        new RazorpayError(null, null, 'Razorpay could not be reached'),
      )
      .mockResolvedValueOnce(['pay_Second000001']);
    const settle = jest.spyOn(service, 'settle').mockResolvedValue({
      kind: 'PAID',
      orderId: 'second-order',
      late: false,
    });

    await expect(service.collectDuePayments(NOW)).resolves.toEqual({
      settled: 1,
      failed: 1,
    });
    expect(settle).toHaveBeenCalledWith('pay_Second000001', NOW);
  });

  it('counts a payment that could not be settled', async () => {
    const { service, prisma, payments } = setup();
    prisma.order.findMany.mockResolvedValueOnce([{ id: ORDER_ID }]);
    payments.razorpayOrdersOf.mockResolvedValueOnce([
      { orderId: ORDER_ID, razorpayOrderId: 'order_Captured01' },
    ]);
    payments.capturedPaymentsOf.mockResolvedValueOnce([captured.id]);
    jest
      .spyOn(service, 'settle')
      .mockRejectedValue(new Error('the database is down'));

    await expect(service.collectDuePayments(NOW)).resolves.toEqual({
      settled: 0,
      failed: 1,
    });
  });
});
