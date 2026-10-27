import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { RetentionService } from './retention.service';

// The first run waits a minute, so it never slows the start.
const FIRST_RUN_DELAY_MS = 60 * 1000;
const RUN_EVERY_MS = 60 * 60 * 1000;

// Runs the retention cleanup inside the API: a minute after startup, then
// every hour. Two runs never overlap.
@Injectable()
export class RetentionScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private firstRun?: NodeJS.Timeout;
  private everyHour?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly retention: RetentionService,
    @InjectPinoLogger(RetentionScheduler.name)
    private readonly logger: PinoLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.firstRun = setTimeout(() => void this.runOnce(), FIRST_RUN_DELAY_MS);
    this.everyHour = setInterval(() => void this.runOnce(), RUN_EVERY_MS);
    // The timers alone must never keep the process alive.
    this.firstRun.unref();
    this.everyHour.unref();
  }

  onModuleDestroy(): void {
    clearTimeout(this.firstRun);
    clearInterval(this.everyHour);
  }

  // One cleanup run. Skipped while the previous one is still going. A failure
  // is logged, and the next run simply tries again.
  async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.retention.purge();
    } catch (error) {
      this.logger.error(
        {
          errorName: error instanceof Error ? error.name : 'unknown',
          code: (error as { code?: unknown }).code,
        },
        'Retention cleanup failed',
      );
    } finally {
      this.running = false;
    }
  }
}
