import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { NotificationKind } from '../generated/prisma/enums';

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
// tells of a change that was undone.
@Injectable()
export class NotificationsService {
  // Saves an email to send, inside the caller's transaction. The database
  // refuses one that does not tell the truth, and the change with it.
  async queue(
    tx: Prisma.TransactionClient,
    entry: NotificationEntry,
  ): Promise<void> {
    await tx.notification.create({ data: entry, select: { id: true } });
  }
}
