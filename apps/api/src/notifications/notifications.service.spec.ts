import type { PinoLogger } from 'nestjs-pino';
import type { Prisma } from '../generated/prisma/client';
import type { NotificationSender } from './notification-sender';
import { NotificationsService } from './notifications.service';

const ORDER_ID = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
const REFUND_ID = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f101';
const NOTHING = { sent: 0, retried: 0, failed: 0 };

function setup() {
  const tx = {
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'n-1' }),
    },
  };
  const sender = { sendDue: jest.fn().mockResolvedValue(NOTHING) };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    service: new NotificationsService(
      sender as unknown as NotificationSender,
      logger as unknown as PinoLogger,
    ),
    tx: tx as unknown as Prisma.TransactionClient,
    txMock: tx,
    sender,
    logger,
  };
}

describe('NotificationsService.queue', () => {
  it('saves an email about an order in the transaction it is given', async () => {
    const { service, tx, txMock, sender } = setup();

    await expect(
      service.queue(tx, { kind: 'ORDER_PAID', orderId: ORDER_ID }),
    ).resolves.toBeUndefined();

    expect(txMock.notification.create).toHaveBeenCalledWith({
      data: { kind: 'ORDER_PAID', orderId: ORDER_ID },
      select: { id: true },
    });
    // Sent only after the transaction is saved, never from inside it.
    expect(sender.sendDue).not.toHaveBeenCalled();
  });

  it('saves an email about a refund with its refund', async () => {
    const { service, tx, txMock } = setup();

    await service.queue(tx, {
      kind: 'REFUND_PROCESSED',
      orderId: ORDER_ID,
      refundId: REFUND_ID,
    });

    expect(txMock.notification.create).toHaveBeenCalledWith({
      data: {
        kind: 'REFUND_PROCESSED',
        orderId: ORDER_ID,
        refundId: REFUND_ID,
      },
      select: { id: true },
    });
  });

  it('passes on what the database refuses, so the change is undone with it', async () => {
    const { service, tx, txMock } = setup();
    const refused = new Error(
      'an email about an order tells the status it is in',
    );
    txMock.notification.create.mockRejectedValueOnce(refused);

    await expect(
      service.queue(tx, { kind: 'ORDER_PACKED', orderId: ORDER_ID }),
    ).rejects.toBe(refused);
  });
});

describe('NotificationsService.wake', () => {
  it('sends the waiting emails in the background, and logs how many', async () => {
    const { service, sender, logger } = setup();
    sender.sendDue.mockResolvedValueOnce({ ...NOTHING, sent: 2 });

    expect(service.wake()).toBeUndefined();
    await service.settled();

    expect(sender.sendDue).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { sent: 2, retried: 0, failed: 0 },
      'Emails sent',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns when some could not be sent, and logs nothing when nothing was due', async () => {
    for (const result of [
      { sent: 1, retried: 1, failed: 0 },
      { sent: 1, retried: 0, failed: 1 },
    ]) {
      const some = setup();
      some.sender.sendDue.mockResolvedValueOnce(result);
      some.service.wake();
      await some.service.settled();
      expect(some.logger.warn).toHaveBeenCalledWith(
        result,
        'Some emails could not be sent',
      );
      expect(some.logger.info).not.toHaveBeenCalled();
    }

    const none = setup();
    none.service.wake();
    await none.service.settled();
    expect(none.sender.sendDue).toHaveBeenCalledTimes(1);
    expect(none.logger.info).not.toHaveBeenCalled();
    expect(none.logger.warn).not.toHaveBeenCalled();
  });

  it('never sends twice at once: woken during a run, however often, it runs once more after it', async () => {
    const { service, sender } = setup();
    let finish: () => void = () => undefined;
    sender.sendDue.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(NOTHING);
        }),
    );

    service.wake();
    service.wake();
    service.wake();
    expect(sender.sendDue).toHaveBeenCalledTimes(1);

    finish();
    await service.settled();
    expect(sender.sendDue).toHaveBeenCalledTimes(2);

    // Done: the next wake starts a new run.
    service.wake();
    await service.settled();
    expect(sender.sendDue).toHaveBeenCalledTimes(3);
  });

  it('never throws: a failed run is logged with its error name and code only, and the next wake runs again', async () => {
    const { service, sender, logger } = setup();
    sender.sendDue.mockRejectedValueOnce(
      Object.assign(new Error("Can't reach database server"), {
        code: 'P1001',
      }),
    );

    expect(() => service.wake()).not.toThrow();
    await expect(service.settled()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      { errorName: 'Error', code: 'P1001' },
      'Sending the waiting emails failed',
    );

    service.wake();
    await service.settled();
    expect(sender.sendDue).toHaveBeenCalledTimes(2);
  });

  it('is settled only once the run going on has ended', async () => {
    const { service, sender } = setup();
    let finish: () => void = () => undefined;
    sender.sendDue.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(NOTHING);
        }),
    );
    let settled = false;

    service.wake();
    const waiting = service.settled().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    finish();
    await waiting;
    expect(settled).toBe(true);
  });

  it('is settled at once when nothing runs', async () => {
    const { service, sender } = setup();

    await expect(service.settled()).resolves.toBeUndefined();
    expect(sender.sendDue).not.toHaveBeenCalled();
  });
});
