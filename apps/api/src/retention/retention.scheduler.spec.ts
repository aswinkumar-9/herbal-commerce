import { PinoLogger } from 'nestjs-pino';
import { RetentionScheduler } from './retention.scheduler';
import { RetentionService } from './retention.service';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function setup() {
  const retention = { purge: jest.fn().mockResolvedValue({}) };
  const logger = { error: jest.fn() };
  const scheduler = new RetentionScheduler(
    retention as unknown as RetentionService,
    logger as unknown as PinoLogger,
  );
  return { scheduler, retention, logger };
}

describe('RetentionScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs a minute after startup, then every hour', async () => {
    const { scheduler, retention } = setup();
    scheduler.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(MINUTE - 1);
    expect(retention.purge).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(retention.purge).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(HOUR);
    expect(retention.purge).toHaveBeenCalledTimes(2);

    scheduler.onModuleDestroy();
  });

  it('stops on shutdown', async () => {
    const { scheduler, retention } = setup();
    scheduler.onApplicationBootstrap();
    scheduler.onModuleDestroy();

    await jest.advanceTimersByTimeAsync(2 * HOUR);
    expect(retention.purge).not.toHaveBeenCalled();
  });

  it('never runs twice at once', async () => {
    const { scheduler, retention } = setup();
    let finish: () => void = () => undefined;
    retention.purge.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = () => resolve();
      }),
    );

    const first = scheduler.runOnce();
    await scheduler.runOnce(); // skipped: the first run is still going
    expect(retention.purge).toHaveBeenCalledTimes(1);

    finish();
    await first;
    await scheduler.runOnce();
    expect(retention.purge).toHaveBeenCalledTimes(2);
  });

  it('logs a failed run without crashing, and tries again next time', async () => {
    const { scheduler, retention, logger } = setup();
    retention.purge.mockRejectedValueOnce(
      Object.assign(new Error('connection lost'), { code: 'P1001' }),
    );

    await expect(scheduler.runOnce()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      { errorName: 'Error', code: 'P1001' },
      'Retention cleanup failed',
    );

    await scheduler.runOnce();
    expect(retention.purge).toHaveBeenCalledTimes(2);
  });
});
