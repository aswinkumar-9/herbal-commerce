import type { Prisma } from '../generated/prisma/client';
import { NotificationsService } from './notifications.service';

const ORDER_ID = '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30';
const REFUND_ID = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f101';

function setup() {
  const tx = {
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'n-1' }),
    },
  };
  return {
    service: new NotificationsService(),
    tx: tx as unknown as Prisma.TransactionClient,
    txMock: tx,
  };
}

describe('NotificationsService.queue', () => {
  it('saves an email about an order in the transaction it is given', async () => {
    const { service, tx, txMock } = setup();

    await expect(
      service.queue(tx, { kind: 'ORDER_PAID', orderId: ORDER_ID }),
    ).resolves.toBeUndefined();

    expect(txMock.notification.create).toHaveBeenCalledWith({
      data: { kind: 'ORDER_PAID', orderId: ORDER_ID },
      select: { id: true },
    });
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
