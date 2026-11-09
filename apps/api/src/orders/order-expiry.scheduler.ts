import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PaymentsService } from '../payments/payments.service';
import { OrderPaymentsService } from './order-payments.service';
import { OrdersService } from './orders.service';

const RUN_EVERY_MS = 60 * 1000;

// Expires unpaid orders inside the API (ADR 0026): every minute, the first
// a minute after startup, so an order's stock comes back within a minute of
// its 15-minute hold. Before that, Razorpay is asked about the orders that
// started paying, so none that was paid expires; after it, Razorpay is
// asked again for refunds it has not taken (ADR 0027). Two runs never
// overlap.
@Injectable()
export class OrderExpiryScheduler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private everyMinute?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly orders: OrdersService,
    private readonly orderPayments: OrderPaymentsService,
    private readonly payments: PaymentsService,
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
  // failure is logged, the other parts still run, and the next run simply
  // tries again.
  async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.part('Finding payments before expiry failed', async () => {
        const found = await this.orderPayments.collectDuePayments();
        if (found.failed > 0) {
          this.logger.warn(
            found,
            'Razorpay could not be asked about some orders before they expired',
          );
        } else if (found.settled > 0) {
          this.logger.info(found, 'Payments found before their orders expired');
        }
      });
      await this.part('Expiring unpaid orders failed', async () => {
        const result = await this.orders.expireUnpaid();
        if (result.failed > 0) {
          this.logger.warn(result, 'Some unpaid orders could not be expired');
        } else if (result.expired > 0) {
          this.logger.info(result, 'Unpaid orders expired');
        }
      });
      await this.part('Asking again for refunds failed', async () => {
        const refunds = await this.payments.retryRefunds();
        if (refunds.notTaken > 0) {
          this.logger.warn(refunds, 'Some refunds are still not taken');
        } else if (refunds.taken > 0) {
          this.logger.info(refunds, 'Refunds taken when asked again');
        }
      });
    } finally {
      this.running = false;
    }
  }

  private async part(failure: string, work: () => Promise<void>) {
    try {
      await work();
    } catch (error) {
      this.logger.error(
        {
          errorName: error instanceof Error ? error.name : 'unknown',
          code: (error as { code?: unknown }).code,
        },
        failure,
      );
    }
  }
}
