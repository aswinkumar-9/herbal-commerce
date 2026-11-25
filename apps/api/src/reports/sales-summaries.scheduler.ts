import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SalesSummariesService } from './sales-summaries.service';

// The first run waits a minute, so it never slows the start.
const FIRST_RUN_DELAY_MS = 60 * 1000;
const RUN_EVERY_MS = 5 * 60 * 1000;

// Rebuilds the recent days' sales summaries inside the API (ADR 0046): a
// minute after startup, then every 5 minutes, so the reports are at most
// about 5 minutes behind (the owner's choice, 2026-11-24). Two runs never
// overlap; two API instances wait for each other in the database.
@Injectable()
export class SalesSummariesScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private firstRun?: NodeJS.Timeout;
  private everyFiveMinutes?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly summaries: SalesSummariesService,
    @InjectPinoLogger(SalesSummariesScheduler.name)
    private readonly logger: PinoLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.firstRun = setTimeout(() => void this.runOnce(), FIRST_RUN_DELAY_MS);
    this.everyFiveMinutes = setInterval(
      () => void this.runOnce(),
      RUN_EVERY_MS,
    );
    // The timers alone must never keep the process alive.
    this.firstRun.unref();
    this.everyFiveMinutes.unref();
  }

  onModuleDestroy(): void {
    clearTimeout(this.firstRun);
    clearInterval(this.everyFiveMinutes);
  }

  // One run. Skipped while the previous one is still going. It logs only
  // the first fill and failures; a failed run is simply tried again next
  // time, and the reports say when they were last rebuilt.
  async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const { everyDay } = await this.summaries.refresh();
      if (everyDay) {
        this.logger.info('Sales summaries filled for every day');
      }
    } catch (error) {
      this.logger.error(
        {
          errorName: error instanceof Error ? error.name : 'unknown',
          code: (error as { code?: unknown }).code,
        },
        'Rebuilding the sales summaries failed',
      );
    } finally {
      this.running = false;
    }
  }
}
