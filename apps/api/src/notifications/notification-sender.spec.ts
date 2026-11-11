import type { PinoLogger } from 'nestjs-pino';
import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import { MAX_ATTEMPTS, NotificationSender } from './notification-sender';
import {
  orderCancelled,
  orderDelivered,
  orderPacked,
  orderPaid,
  orderShipped,
  refundFailed,
  refundProcessed,
} from './order-emails';

const NOW = new Date('2026-11-11T06:00:00.000Z');
const MINUTE = 60 * 1000;
const ID = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e101';
const REFUND_ID = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f101';

const order = {
  reference: '7KQ2M9XDPA',
  itemsTotalRupees: 449,
  itemsGstRupees: 21,
  deliveryChargeRupees: 49,
  totalRupees: 498,
  deliveryName: 'Asha K',
  deliveryLine1: '12, 3rd Cross',
  deliveryLine2: null,
  deliveryCity: 'Bengaluru',
  deliveryState: 'Karnataka',
  deliveryPincode: '560038',
  courierName: null as string | null,
  trackingNumber: null as string | null,
  items: [
    {
      productName: 'Ashwagandha Capsules',
      quantity: 60,
      unit: 'CAPSULES' as const,
      packs: 1,
      lineTotalRupees: 449,
    },
  ],
  payment: null as { refunds: { amountRupees: number }[] } | null,
  user: { email: 'asha.k@example.com', fullName: 'Asha K' },
};
const shipped = {
  ...order,
  courierName: 'Delhivery',
  trackingNumber: 'EE149081123456',
};
const refund = { id: REFUND_ID, amountRupees: 498, reason: 'ALREADY_PAID' };

// An email as the sender reads it, once claimed: its first try.
const row = (fields: Record<string, unknown> = {}) => ({
  id: ID,
  kind: 'ORDER_PAID',
  attempts: 1,
  refund: null,
  order,
  ...fields,
});

function setup() {
  const prisma = {
    notification: {
      findMany: jest.fn().mockResolvedValue([{ id: ID }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(row()),
    },
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { email: 'dev.one@example.com' },
          { email: 'dev.two@example.com' },
        ]),
    },
  };
  const mail = { send: jest.fn().mockResolvedValue(undefined) };
  const logger = { warn: jest.fn(), error: jest.fn() };
  const sender = new NotificationSender(
    prisma as unknown as PrismaService,
    mail as unknown as MailService,
    logger as unknown as PinoLogger,
  );
  return { sender, prisma, mail, logger };
}

describe('NotificationSender.sendDue', () => {
  it('sends the emails that are due, the longest waiting first: each claimed, written, sent and marked sent', async () => {
    const { sender, prisma, mail } = setup();

    await expect(sender.sendDue(NOW)).resolves.toEqual({
      sent: 1,
      retried: 0,
      failed: 0,
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { status: 'WAITING', nextAttemptAt: { lte: NOW } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 50,
      select: { id: true },
    });
    // The claim: one more try, and no other sender for 5 minutes.
    expect(prisma.notification.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: ID, status: 'WAITING', nextAttemptAt: { lte: NOW } },
      data: {
        attempts: { increment: 1 },
        nextAttemptAt: new Date(NOW.getTime() + 5 * MINUTE),
      },
    });
    expect(
      prisma.notification.findUniqueOrThrow.mock.calls[0][0],
    ).toMatchObject({
      where: { id: ID },
      select: {
        order: {
          select: { user: { select: { email: true, fullName: true } } },
        },
      },
    });
    expect(mail.send).toHaveBeenCalledWith({
      to: 'asha.k@example.com',
      ...orderPaid('Asha K', order),
    });
    expect(prisma.notification.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: ID, status: 'WAITING' },
      data: { status: 'SENT', sentAt: NOW },
    });
    const claimed = prisma.notification.updateMany.mock.invocationCallOrder[0];
    const read =
      prisma.notification.findUniqueOrThrow.mock.invocationCallOrder[0];
    const sent = mail.send.mock.invocationCallOrder[0];
    const marked = prisma.notification.updateMany.mock.invocationCallOrder[1];
    expect(claimed < read && read < sent && sent < marked).toBe(true);
  });

  it('sends nothing when nothing is due', async () => {
    const { sender, prisma, mail } = setup();
    prisma.notification.findMany.mockResolvedValueOnce([]);

    await expect(sender.sendDue(NOW)).resolves.toEqual({
      sent: 0,
      retried: 0,
      failed: 0,
    });
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('leaves alone an email another sender has claimed', async () => {
    const { sender, prisma, mail } = setup();
    prisma.notification.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(sender.sendDue(NOW)).resolves.toEqual({
      sent: 0,
      retried: 0,
      failed: 0,
    });
    expect(prisma.notification.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
    expect(prisma.notification.updateMany).toHaveBeenCalledTimes(1);
  });

  it("writes each email to its order's customer, from what the order is now", async () => {
    const cases = [
      [row({ kind: 'ORDER_PACKED' }), orderPacked('Asha K', '7KQ2M9XDPA')],
      [
        row({ kind: 'ORDER_SHIPPED', order: shipped }),
        orderShipped(
          'Asha K',
          {
            reference: '7KQ2M9XDPA',
            courierName: 'Delhivery',
            trackingNumber: 'EE149081123456',
          },
          false,
        ),
      ],
      [
        row({ kind: 'SHIPMENT_CORRECTED', order: shipped }),
        orderShipped(
          'Asha K',
          {
            reference: '7KQ2M9XDPA',
            courierName: 'Delhivery',
            trackingNumber: 'EE149081123456',
          },
          true,
        ),
      ],
      [
        row({ kind: 'ORDER_DELIVERED', order: shipped }),
        orderDelivered('Asha K', '7KQ2M9XDPA'),
      ],
      [
        row({ kind: 'ORDER_CANCELLED' }),
        orderCancelled('Asha K', '7KQ2M9XDPA', null),
      ],
      [
        row({
          kind: 'ORDER_CANCELLED',
          order: { ...order, payment: { refunds: [] } },
        }),
        orderCancelled('Asha K', '7KQ2M9XDPA', null),
      ],
      [
        row({
          kind: 'ORDER_CANCELLED',
          order: { ...order, payment: { refunds: [{ amountRupees: 498 }] } },
        }),
        orderCancelled('Asha K', '7KQ2M9XDPA', 498),
      ],
      [
        row({ kind: 'REFUND_PROCESSED', refund }),
        refundProcessed('Asha K', '7KQ2M9XDPA', 498, 'ALREADY_PAID'),
      ],
    ] as const;
    for (const [found, content] of cases) {
      const { sender, prisma, mail } = setup();
      prisma.notification.findUniqueOrThrow.mockResolvedValueOnce(found);

      await expect(sender.sendDue(NOW)).resolves.toMatchObject({ sent: 1 });

      expect(mail.send).toHaveBeenCalledWith({
        to: 'asha.k@example.com',
        ...content,
      });
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    }
  });

  it('tells every active Super User of a failed refund, in one email', async () => {
    const { sender, prisma, mail } = setup();
    prisma.notification.findUniqueOrThrow.mockResolvedValueOnce(
      row({ kind: 'REFUND_FAILED', refund }),
    );

    await sender.sendDue(NOW);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: 'SUPER_USER', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { email: true },
    });
    expect(mail.send).toHaveBeenCalledWith({
      to: 'dev.one@example.com, dev.two@example.com',
      ...refundFailed('7KQ2M9XDPA', REFUND_ID, 498, 'ALREADY_PAID'),
    });
  });

  it('tries again later when sending fails: 1, 2, 4 ... minutes, at most an hour, and logs no address', async () => {
    for (const [attempts, minutes] of [
      [1, 1],
      [2, 2],
      [3, 4],
      [6, 32],
      [7, 60],
      [MAX_ATTEMPTS - 1, 60],
    ]) {
      const { sender, prisma, mail, logger } = setup();
      prisma.notification.findUniqueOrThrow.mockResolvedValueOnce(
        row({ attempts }),
      );
      mail.send.mockRejectedValueOnce(
        Object.assign(new Error('Connection refused'), {
          code: 'ECONNECTION',
        }),
      );

      await expect(sender.sendDue(NOW)).resolves.toEqual({
        sent: 0,
        retried: 1,
        failed: 0,
      });

      expect(prisma.notification.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: ID, status: 'WAITING' },
        data: { nextAttemptAt: new Date(NOW.getTime() + minutes * MINUTE) },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        {
          notificationId: ID,
          kind: 'ORDER_PAID',
          attempts,
          errorName: 'Error',
          code: 'ECONNECTION',
        },
        'An email could not be sent: it is tried again later',
      );
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('@');
      expect(logger.error).not.toHaveBeenCalled();
    }
  });

  it('fails an email for good after its last try, and says so in the log', async () => {
    const { sender, prisma, mail, logger } = setup();
    prisma.notification.findUniqueOrThrow.mockResolvedValueOnce(
      row({ attempts: MAX_ATTEMPTS }),
    );
    mail.send.mockRejectedValueOnce(new TypeError('no such mailbox'));

    await expect(sender.sendDue(NOW)).resolves.toEqual({
      sent: 0,
      retried: 0,
      failed: 1,
    });

    expect(MAX_ATTEMPTS).toBe(10);
    expect(prisma.notification.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: ID, status: 'WAITING' },
      data: { status: 'FAILED' },
    });
    expect(logger.error).toHaveBeenCalledWith(
      {
        notificationId: ID,
        kind: 'ORDER_PAID',
        attempts: MAX_ATTEMPTS,
        errorName: 'TypeError',
        code: undefined,
      },
      'An email could not be sent, and is not tried again',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('tries again later when an email cannot be written: no Super User, or no shipment or refund to tell of', async () => {
    for (const found of [
      row({ kind: 'REFUND_FAILED', refund }),
      row({ kind: 'ORDER_SHIPPED' }),
      row({
        kind: 'SHIPMENT_CORRECTED',
        order: { ...shipped, trackingNumber: null },
      }),
      row({ kind: 'REFUND_PROCESSED' }),
    ]) {
      const { sender, prisma, mail } = setup();
      prisma.user.findMany.mockResolvedValueOnce([]);
      prisma.notification.findUniqueOrThrow.mockResolvedValueOnce(found);

      await expect(sender.sendDue(NOW)).resolves.toEqual({
        sent: 0,
        retried: 1,
        failed: 0,
      });
      expect(mail.send).not.toHaveBeenCalled();
    }
  });

  it('goes on with the next email after one that fails', async () => {
    const { sender, prisma, mail } = setup();
    prisma.notification.findMany.mockResolvedValueOnce([
      { id: ID },
      { id: 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e202' },
    ]);
    mail.send.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(sender.sendDue(NOW)).resolves.toEqual({
      sent: 1,
      retried: 1,
      failed: 0,
    });
    expect(mail.send).toHaveBeenCalledTimes(2);
  });
});
