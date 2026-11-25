import { PinoLogger } from 'nestjs-pino';
import { SalesSummariesScheduler } from './sales-summaries.scheduler';
import { SalesSummariesService } from './sales-summaries.service';

const MINUTE = 60 * 1000;

function setup() {
  const summaries = {
    refresh: jest.fn().mockResolvedValue({ everyDay: false }),
  };
  const logger = { info: jest.fn(), error: jest.fn() };
  const scheduler = new SalesSummariesScheduler(
    summaries as unknown as SalesSummariesService,
    logger as unknown as PinoLogger,
  );
  return { scheduler, summaries, logger };
}

describe('SalesSummariesScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs a minute after startup, then every 5 minutes', async () => {
    const { scheduler, summaries } = setup();
    scheduler.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(MINUTE - 1);
    expect(summaries.refresh).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(summaries.refresh).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(4 * MINUTE - 1);
    expect(summaries.refresh).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(summaries.refresh).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    expect(summaries.refresh).toHaveBeenCalledTimes(3);

    scheduler.onModuleDestroy();
  });

  it('stops on shutdown', async () => {
    const { scheduler, summaries } = setup();
    scheduler.onApplicationBootstrap();
    scheduler.onModuleDestroy();

    await jest.advanceTimersByTimeAsync(30 * MINUTE);
    expect(summaries.refresh).not.toHaveBeenCalled();
  });

  it('never runs twice at once', async () => {
    const { scheduler, summaries } = setup();
    let finish: () => void = () => undefined;
    summaries.refresh.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve({ everyDay: false });
      }),
    );

    const first = scheduler.runOnce();
    await scheduler.runOnce(); // skipped: the first run is still going
    expect(summaries.refresh).toHaveBeenCalledTimes(1);

    finish();
    await first;
    await scheduler.runOnce();
    expect(summaries.refresh).toHaveBeenCalledTimes(2);
  });

  it('logs only the first fill of every day', async () => {
    const { scheduler, summaries, logger } = setup();
    summaries.refresh.mockResolvedValueOnce({ everyDay: true });

    await scheduler.runOnce();
    expect(logger.info).toHaveBeenCalledWith(
      'Sales summaries filled for every day',
    );
    await scheduler.runOnce();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a failed run without crashing, and tries again next time', async () => {
    const { scheduler, summaries, logger } = setup();
    summaries.refresh.mockRejectedValueOnce(
      Object.assign(new Error('connection lost'), { code: 'P1001' }),
    );

    await expect(scheduler.runOnce()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      { errorName: 'Error', code: 'P1001' },
      'Rebuilding the sales summaries failed',
    );

    await scheduler.runOnce();
    expect(summaries.refresh).toHaveBeenCalledTimes(2);
  });
});
