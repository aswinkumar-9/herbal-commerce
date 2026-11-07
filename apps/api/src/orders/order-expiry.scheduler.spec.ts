import { PinoLogger } from 'nestjs-pino';
import { OrderExpiryScheduler } from './order-expiry.scheduler';
import { OrdersService } from './orders.service';

const MINUTE = 60 * 1000;

function setup() {
  const orders = {
    expireUnpaid: jest.fn().mockResolvedValue({ expired: 0, failed: 0 }),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const scheduler = new OrderExpiryScheduler(
    orders as unknown as OrdersService,
    logger as unknown as PinoLogger,
  );
  return { scheduler, orders, logger };
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

  it('never runs twice at once', async () => {
    const { scheduler, orders } = setup();
    let finish: () => void = () => undefined;
    orders.expireUnpaid.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve({ expired: 0, failed: 0 });
      }),
    );

    const first = scheduler.runOnce();
    await scheduler.runOnce(); // skipped: the first run is still going
    expect(orders.expireUnpaid).toHaveBeenCalledTimes(1);

    finish();
    await first;
    await scheduler.runOnce();
    expect(orders.expireUnpaid).toHaveBeenCalledTimes(2);
  });

  it('logs counts only, and only when it did something', async () => {
    const { scheduler, orders, logger } = setup();

    await scheduler.runOnce();
    expect(logger.info).not.toHaveBeenCalled();

    orders.expireUnpaid.mockResolvedValueOnce({ expired: 2, failed: 0 });
    await scheduler.runOnce();
    expect(logger.info).toHaveBeenCalledWith(
      { expired: 2, failed: 0 },
      'Unpaid orders expired',
    );

    orders.expireUnpaid.mockResolvedValueOnce({ expired: 1, failed: 1 });
    await scheduler.runOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      { expired: 1, failed: 1 },
      'Some unpaid orders could not be expired',
    );
  });

  it('logs a failed run without crashing, and tries again next time', async () => {
    const { scheduler, orders, logger } = setup();
    orders.expireUnpaid.mockRejectedValueOnce(
      Object.assign(new Error('connection lost'), { code: 'P1001' }),
    );

    await expect(scheduler.runOnce()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      { errorName: 'Error', code: 'P1001' },
      'Expiring unpaid orders failed',
    );

    await scheduler.runOnce();
    expect(orders.expireUnpaid).toHaveBeenCalledTimes(2);
  });
});
