import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { OrdersService } from './orders.service';

const RUN_EVERY_MS = 60 * 1000;

// Expires unpaid orders inside the API (ADR 0026): every minute, the first
// a minute after startup, so an order's stock comes back within a minute of
// its 15-minute hold. Two runs never overlap.
@Injectable()
export class OrderExpiryScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private everyMinute?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly orders: OrdersService,
    @InjectPinoLogger(OrderExpiryScheduler.name)
    private readonly logger: PinoLogger,
  ) {}

  onApplicationBootstrap(): void {
    this.everyMinute = setInterval(() => void this.runOnce(), RUN_EVERY_MS);
    // The timer alone must never keep the process alive.
    this.everyMinute.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.everyMinute);
  }

  // One run. Skipped while the previous one is still going. It logs only
  // when it did something, and counts only: nothing about the orders. A
  // failure is logged, and the next run simply tries again.
  async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const result = await this.orders.expireUnpaid();
      if (result.failed > 0) {
        this.logger.warn(result, 'Some unpaid orders could not be expired');
      } else if (result.expired > 0) {
        this.logger.info(result, 'Unpaid orders expired');
      }
    } catch (error) {
      this.logger.error(
        {
          errorName: error instanceof Error ? error.name : 'unknown',
          code: (error as { code?: unknown }).code,
        },
        'Expiring unpaid orders failed',
      );
    } finally {
      this.running = false;
    }
  }
}
