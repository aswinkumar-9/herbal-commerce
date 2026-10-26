import { ConcurrencyLimit } from './concurrency-limit';
import { RetryLaterException } from './retry-later.exception';

// A promise the test resolves by hand, to keep a task "running".
function gate() {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

// Lets every pending promise callback run.
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('ConcurrencyLimit', () => {
  it('runs at most two tasks at once, and the rest in arrival order', async () => {
    const limit = new ConcurrencyLimit(2, 10);
    const started: number[] = [];
    const gates = [gate(), gate(), gate(), gate()];
    const runs = gates.map((g, i) =>
      limit.run(async () => {
        started.push(i);
        await g.promise;
        return i;
      }),
    );

    expect(started).toEqual([0, 1]);
    gates[1].open();
    await settle();
    expect(started).toEqual([0, 1, 2]);

    for (const g of gates) {
      g.open();
    }
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2, 3]);
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it('refuses at once with 503 SERVER_BUSY when the line is full', async () => {
    const limit = new ConcurrencyLimit(1, 1);
    const g = gate();
    const running = limit.run(() => g.promise);
    const waiting = limit.run(() => Promise.resolve());

    const refused = await limit
      .run(() => Promise.resolve())
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RetryLaterException);
    const exception = refused as RetryLaterException;
    expect(exception.getStatus()).toBe(503);
    expect(exception.getResponse()).toMatchObject({ code: 'SERVER_BUSY' });
    expect(exception.retryAfterSeconds).toBe(5);

    g.open();
    await Promise.all([running, waiting]);
  });

  it('frees the slot when a task fails', async () => {
    const limit = new ConcurrencyLimit(1, 1);

    await expect(
      limit.run(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    await expect(limit.run(() => Promise.resolve('next'))).resolves.toBe('next');
  });
});
