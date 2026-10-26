import { RetryLaterException } from './retry-later.exception';

// Runs at most `maxRunning` tasks at once; up to `maxWaiting` more wait in
// line, in order. Beyond that it refuses at once with 503 SERVER_BUSY, so a
// burst cannot pile up work and memory without end.
export class ConcurrencyLimit {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly maxRunning: number,
    private readonly maxWaiting: number,
  ) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running < this.maxRunning) {
      this.running += 1;
    } else if (this.waiting.length < this.maxWaiting) {
      // Wait until a finished task hands over its slot.
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
      });
    } else {
      throw new RetryLaterException(
        503,
        'The server is busy. Please try again in a few seconds.',
        'SERVER_BUSY',
        5,
      );
    }
    try {
      return await task();
    } finally {
      // Hand the slot straight to the next in line, or free it.
      const next = this.waiting.shift();
      if (next) {
        next();
      } else {
        this.running -= 1;
      }
    }
  }
}
