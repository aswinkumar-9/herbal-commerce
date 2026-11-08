import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { RetryLaterException } from '../common/retry-later.exception';
import type { PaymentsService } from '../payments/payments.service';
import { RazorpayError } from '../payments/razorpay.gateway';
import type { PrismaService } from '../prisma/prisma.service';
import { OrderPaymentsService } from './order-payments.service';

const USER = 'user-1';
const ORDER_ID = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
const NOW = new Date('2026-11-08T06:00:00.000Z');
const HOLD = new Date('2026-11-08T06:10:00.000Z');

const order = {
  id: ORDER_ID,
  reference: '7KQ2M9XDPA',
  status: 'PENDING_PAYMENT',
  totalRupees: 498,
  holdExpiresAt: HOLD,
};

function setup() {
  const prisma = {
    order: { findFirst: jest.fn().mockResolvedValue(order) },
  };
  const payments = {
    keyId: 'rzp_test_FakeKey0123',
    razorpayOrderFor: jest.fn().mockResolvedValue('order_RB58MiP5SPFYyM'),
  };
  const logger = { error: jest.fn() };
  const service = new OrderPaymentsService(
    prisma as unknown as PrismaService,
    payments as unknown as PaymentsService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, payments, logger };
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
