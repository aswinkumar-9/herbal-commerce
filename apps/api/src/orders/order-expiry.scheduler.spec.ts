import { PinoLogger } from 'nestjs-pino';
import type { PaymentsService } from '../payments/payments.service';
import { OrderExpiryScheduler } from './order-expiry.scheduler';
import type { OrderPaymentsService } from './order-payments.service';
import { OrdersService } from './orders.service';

const MINUTE = 60 * 1000;

function setup() {
  const orders = {
    expireUnpaid: jest.fn().mockResolvedValue({ expired: 0, failed: 0 }),
  };
  const orderPayments = {
    collectDuePayments: jest.fn().mockResolvedValue({ settled: 0, failed: 0 }),
  };
  const payments = {
    retryRefunds: jest.fn().mockResolvedValue({ taken: 0, notTaken: 0 }),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const scheduler = new OrderExpiryScheduler(
    orders as unknown as OrdersService,
    orderPayments as unknown as OrderPaymentsService,
    payments as unknown as PaymentsService,
    logger as unknown as PinoLogger,
  );
  return { scheduler, orders, orderPayments, payments, logger };
}

describe('OrderExpiryScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs a minute after startup, then every minute', async () => {
    const { scheduler, orders } = setup();
    scheduler.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(MINUTE - 1);
    expect(orders.expireUnpaid).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(orders.expireUnpaid).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(MINUTE);
    expect(orders.expireUnpaid).toHaveBeenCalledTimes(2);

    scheduler.onModuleDestroy();
  });

  it('stops on shutdown', async () => {
    const { scheduler, orders } = setup();
    scheduler.onApplicationBootstrap();
    scheduler.onModuleDestroy();

    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    expect(orders.expireUnpaid).not.toHaveBeenCalled();
  });

  it('first finds payments that came in time, then expires orders, then asks again for refunds', async () => {
    const { scheduler, orders, orderPayments, payments } = setup();

    await scheduler.runOnce();

    const found = orderPayments.collectDuePayments.mock.invocationCallOrder[0];
    const expired = orders.expireUnpaid.mock.invocationCallOrder[0];
    const refunds = payments.retryRefunds.mock.invocationCallOrder[0];
    expect(found < expired && expired < refunds).toBe(true);
  });

  it('never runs twice at once', async () => {
    const { scheduler, orders, orderPayments } = setup();
    let finish: () => void = () => undefined;
    orderPayments.collectDuePayments.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve({ settled: 0, failed: 0 });
      }),
    );

    const first = scheduler.runOnce();
    await scheduler.runOnce(); // skipped: the first run is still going
    expect(orderPayments.collectDuePayments).toHaveBeenCalledTimes(1);
    expect(orders.expireUnpaid).not.toHaveBeenCalled();

    finish();
    await first;
    expect(orders.expireUnpaid).toHaveBeenCalledTimes(1);
    await scheduler.runOnce();
    expect(orderPayments.collectDuePayments).toHaveBeenCalledTimes(2);
    expect(orders.expireUnpaid).toHaveBeenCalledTimes(2);
  });

  it('logs counts only, and only when it did something', async () => {
    const { scheduler, orders, orderPayments, payments, logger } = setup();

    await scheduler.runOnce();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();

    orders.expireUnpaid.mockResolvedValueOnce({ expired: 2, failed: 0 });
    orderPayments.collectDuePayments.mockResolvedValueOnce({
      settled: 1,
      failed: 0,
    });
    payments.retryRefunds.mockResolvedValueOnce({ taken: 3, notTaken: 0 });
    await scheduler.runOnce();
    expect(logger.info).toHaveBeenCalledWith(
      { expired: 2, failed: 0 },
      'Unpaid orders expired',
    );
    expect(logger.info).toHaveBeenCalledWith(
      { settled: 1, failed: 0 },
      'Payments found before their orders expired',
    );
    expect(logger.info).toHaveBeenCalledWith(
      { taken: 3, notTaken: 0 },
      'Refunds taken when asked again',
    );

    orders.expireUnpaid.mockResolvedValueOnce({ expired: 1, failed: 1 });
    orderPayments.collectDuePayments.mockResolvedValueOnce({
      settled: 1,
      failed: 1,
    });
    payments.retryRefunds.mockResolvedValueOnce({ taken: 1, notTaken: 1 });
    await scheduler.runOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      { expired: 1, failed: 1 },
      'Some unpaid orders could not be expired',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { settled: 1, failed: 1 },
      'Razorpay could not be asked about some orders before they expired',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { taken: 1, notTaken: 1 },
      'Some refunds are still not taken',
    );
  });

  it('logs a failed part without crashing, runs the others, and tries again next time', async () => {
    const { scheduler, orders, orderPayments, payments, logger } = setup();
    orders.expireUnpaid.mockRejectedValueOnce(
      Object.assign(new Error('connection lost'), { code: 'P1001' }),
    );
    orderPayments.collectDuePayments.mockRejectedValueOnce(
      new TypeError('broken'),
    );
    payments.retryRefunds.mockRejectedValueOnce('not an error');

    await expect(scheduler.runOnce()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      { errorName: 'Error', code: 'P1001' },
      'Expiring unpaid orders failed',
    );
    expect(logger.error).toHaveBeenCalledWith(
      { errorName: 'TypeError', code: undefined },
      'Finding payments before expiry failed',
    );
    expect(logger.error).toHaveBeenCalledWith(
      { errorName: 'unknown', code: undefined },
      'Asking again for refunds failed',
    );

    await scheduler.runOnce();
    expect(orders.expireUnpaid).toHaveBeenCalledTimes(2);
    expect(orderPayments.collectDuePayments).toHaveBeenCalledTimes(2);
    expect(payments.retryRefunds).toHaveBeenCalledTimes(2);
  });
});
