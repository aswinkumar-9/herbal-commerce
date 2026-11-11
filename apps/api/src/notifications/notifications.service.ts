import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Prisma } from '../generated/prisma/client';
import type { NotificationKind } from '../generated/prisma/enums';
import { NotificationSender } from './notification-sender';

// The emails that tell what happened to a refund.
export type RefundNotificationKind = Extract<
  NotificationKind,
  'REFUND_PROCESSED' | 'REFUND_FAILED'
>;

// An email to send (ADR 0029): what it tells, and of which order. An email
// about a refund names the refund too, as the database insists.
export type NotificationEntry =
  | {
      kind: Exclude<NotificationKind, RefundNotificationKind>;
      orderId: string;
    }
  | { kind: RefundNotificationKind; orderId: string; refundId: string };

// The emails about orders and their refunds (ADR 0029). Each is saved in
// the transaction of the change it tells of: so none is lost, and none
// tells of a change that was undone. Then it is sent.
@Injectable()
export class NotificationsService {
  // The run that is sending now, if any, and whether another must follow.
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly sender: NotificationSender,
    @InjectPinoLogger(NotificationsService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Saves an email to send, inside the caller's transaction. The database
  // refuses one that does not tell the truth, and the change with it.
  async queue(
    tx: Prisma.TransactionClient,
    entry: NotificationEntry,
  ): Promise<void> {
    await tx.notification.create({ data: entry, select: { id: true } });
  }

  // Sends the waiting emails, in the background: every minute, by the job.
  // Never throws. Woken while a run is going, it runs once more after it,
  // so an email saved meanwhile is not left waiting.
  wake(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.sendWhileWoken();
  }

  // Ends when the run going now, if any, has ended: so the API stops only
  // after it.
  async settled(): Promise<void> {
    await this.running;
  }

  private async sendWhileWoken(): Promise<void> {
    try {
      do {
        this.again = false;
        const result = await this.sender.sendDue();
        if (result.retried > 0 || result.failed > 0) {
          this.logger.warn(result, 'Some emails could not be sent');
        } else if (result.sent > 0) {
          this.logger.info(result, 'Emails sent');
        }
      } while (this.again);
    } catch (error) {
      this.logger.error(
        {
          errorName: error instanceof Error ? error.name : 'unknown',
          code: (error as { code?: unknown }).code,
        },
        'Sending the waiting emails failed',
      );
    } finally {
      this.running = null;
      this.again = false;
    }
  }
}
