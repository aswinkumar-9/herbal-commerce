import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Prisma } from '../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import type { MailMessage } from '../mail/mail.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  orderCancelled,
  orderDelivered,
  orderPacked,
  orderPaid,
  orderShipped,
  refundFailed,
  refundProcessed,
} from './order-emails';

// At most this many emails in one run; the rest wait for the next.
const SEND_PER_RUN = 50;
// While one sender has an email, no other takes it, for this long: if the
// API stops halfway, the email is tried again after it.
const CLAIM_MS = 5 * 60 * 1000;
// After a failed try, the email waits 1, 2, 4 ... minutes, at most an hour.
// After this many tries (about 4 hours), it fails, and the log says so.
export const MAX_ATTEMPTS = 10;

export function retryAfterMs(attempts: number): number {
  return Math.min(2 ** (attempts - 1), 60) * 60 * 1000;
}

// What an email is written from: the order, its customer, and the refund.
// Read, never changed: they belong to the orders, the payments and the
// accounts.
const NOTIFICATION_FIELDS = {
  id: true,
  kind: true,
  attempts: true,
  refund: { select: { id: true, amountRupees: true, reason: true } },
  order: {
    select: {
      reference: true,
      itemsTotalRupees: true,
      itemsGstRupees: true,
      deliveryChargeRupees: true,
      totalRupees: true,
      deliveryName: true,
      deliveryLine1: true,
      deliveryLine2: true,
      deliveryCity: true,
      deliveryState: true,
      deliveryPincode: true,
      courierName: true,
      trackingNumber: true,
      items: {
        orderBy: { position: 'asc' },
        select: {
          productName: true,
          quantity: true,
          unit: true,
          packs: true,
          lineTotalRupees: true,
        },
      },
      // A cancelled order's payment going back, if it was paid.
      payment: {
        select: {
          refunds: {
            where: {
              reason: { in: ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_STAFF'] },
            },
            select: { amountRupees: true },
          },
        },
      },
      user: { select: { email: true, fullName: true } },
    },
  },
} satisfies Prisma.NotificationSelect;

type NotificationRow = Prisma.NotificationGetPayload<{
  select: typeof NOTIFICATION_FIELDS;
}>;

type Outcome = 'sent' | 'retried' | 'failed';

// Sends the emails that wait (ADR 0029): each claimed first, so two senders
// never send the same one, then written from what the order is now, and
// marked sent. One that can't be sent is tried again later, and fails after
// MAX_ATTEMPTS tries. An email sent just before the API stops, and not yet
// marked, is sent again: at least once, rarely twice.
@Injectable()
export class NotificationSender {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @InjectPinoLogger(NotificationSender.name)
    private readonly logger: PinoLogger,
  ) {}

  // Sends the emails that are due, the longest waiting first. Answers how
  // many were sent, will be tried again, and failed for good.
  async sendDue(now = new Date()): Promise<Record<Outcome, number>> {
    const due = await this.prisma.notification.findMany({
      where: { status: 'WAITING', nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: SEND_PER_RUN,
      select: { id: true },
    });
    const counts: Record<Outcome, number> = { sent: 0, retried: 0, failed: 0 };
    for (const { id } of due) {
      const outcome = await this.sendOne(id, now);
      if (outcome) {
        counts[outcome] += 1;
      }
    }
    return counts;
  }

  // Claims one email, sends it and marks it sent. Answers null when another
  // sender has it.
  private async sendOne(id: string, now: Date): Promise<Outcome | null> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, status: 'WAITING', nextAttemptAt: { lte: now } },
      data: {
        attempts: { increment: 1 },
        nextAttemptAt: new Date(now.getTime() + CLAIM_MS),
      },
    });
    if (count === 0) {
      return null;
    }
    const notification = await this.prisma.notification.findUniqueOrThrow({
      where: { id },
      select: NOTIFICATION_FIELDS,
    });
    try {
      await this.mail.send(await this.write(notification));
    } catch (error) {
      return this.notSent(notification, error, now);
    }
    await this.prisma.notification.updateMany({
      where: { id, status: 'WAITING' },
      data: { status: 'SENT', sentAt: now },
    });
    return 'sent';
  }

  private async write({
    kind,
    order,
    refund,
  }: NotificationRow): Promise<MailMessage> {
    const { email: to, fullName } = order.user;
    switch (kind) {
      case 'ORDER_PAID':
        return { to, ...orderPaid(fullName, order) };
      case 'ORDER_PACKED':
        return { to, ...orderPacked(fullName, order.reference) };
      case 'ORDER_SHIPPED':
      case 'SHIPMENT_CORRECTED': {
        const { reference, courierName, trackingNumber } = order;
        // The database insists on both once an order has shipped.
        if (!courierName || !trackingNumber) {
          throw new Error(
            'A shipped order names no courier or tracking number',
          );
        }
        return {
          to,
          ...orderShipped(
            fullName,
            { reference, courierName, trackingNumber },
            kind === 'SHIPMENT_CORRECTED',
          ),
        };
      }
      case 'ORDER_DELIVERED':
        return { to, ...orderDelivered(fullName, order.reference) };
      case 'ORDER_CANCELLED':
        return {
          to,
          ...orderCancelled(
            fullName,
            order.reference,
            order.payment?.refunds[0]?.amountRupees ?? null,
          ),
        };
      case 'REFUND_PROCESSED':
      case 'REFUND_FAILED': {
        // The database insists on a refund for these.
        if (!refund) {
          throw new Error('An email about a refund names no refund');
        }
        return kind === 'REFUND_PROCESSED'
          ? {
              to,
              ...refundProcessed(
                fullName,
                order.reference,
                refund.amountRupees,
                refund.reason,
              ),
            }
          : {
              to: await this.superUsers(),
              ...refundFailed(
                order.reference,
                refund.id,
                refund.amountRupees,
                refund.reason,
              ),
            };
      }
    }
  }

  // Every active Super User, in one email: the developers, who know each
  // other.
  private async superUsers(): Promise<string> {
    const superUsers = await this.prisma.user.findMany({
      where: { role: 'SUPER_USER', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { email: true },
    });
    if (superUsers.length === 0) {
      throw new Error('No active Super User to tell');
    }
    return superUsers.map((user) => user.email).join(', ');
  }

  // Tries again later, or fails after the last try. The log names the
  // email and why, never an address.
  private async notSent(
    { id, kind, attempts }: NotificationRow,
    error: unknown,
    now: Date,
  ): Promise<Outcome> {
    const why = {
      notificationId: id,
      kind,
      attempts,
      errorName: error instanceof Error ? error.name : 'unknown',
      code: (error as { code?: unknown }).code,
    };
    if (attempts >= MAX_ATTEMPTS) {
      await this.prisma.notification.updateMany({
        where: { id, status: 'WAITING' },
        data: { status: 'FAILED' },
      });
      this.logger.error(
        why,
        'An email could not be sent, and is not tried again',
      );
      return 'failed';
    }
    await this.prisma.notification.updateMany({
      where: { id, status: 'WAITING' },
      data: { nextAttemptAt: new Date(now.getTime() + retryAfterMs(attempts)) },
    });
    this.logger.warn(
      why,
      'An email could not be sent: it is tried again later',
    );
    return 'retried';
  }
}
