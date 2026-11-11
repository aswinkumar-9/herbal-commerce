import { NotificationsScheduler } from './notifications.scheduler';
import type { NotificationsService } from './notifications.service';

const MINUTE = 60 * 1000;

function setup() {
  const notifications = {
    wake: jest.fn(),
    settled: jest.fn().mockResolvedValue(undefined),
  };
  const scheduler = new NotificationsScheduler(
    notifications as unknown as NotificationsService,
  );
  return { scheduler, notifications };
}

describe('NotificationsScheduler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends the waiting emails a minute after startup, then every minute', async () => {
    const { scheduler, notifications } = setup();
    scheduler.onApplicationBootstrap();

    await jest.advanceTimersByTimeAsync(MINUTE - 1);
    expect(notifications.wake).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(notifications.wake).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(MINUTE);
    expect(notifications.wake).toHaveBeenCalledTimes(2);

    await scheduler.onModuleDestroy();
  });

  it('stops on shutdown, once the run going on has ended', async () => {
    const { scheduler, notifications } = setup();
    scheduler.onApplicationBootstrap();

    await scheduler.onModuleDestroy();
    expect(notifications.settled).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    expect(notifications.wake).not.toHaveBeenCalled();
  });
});
