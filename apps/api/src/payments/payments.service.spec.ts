import type { PinoLogger } from 'nestjs-pino';
import type { Prisma } from '../generated/prisma/client';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';
import { RazorpayError, type RazorpayGateway } from './razorpay.gateway';

const ORDER = {
  orderId: '4f7c2a9e-3b1d-4e8a-9c6f-2d5b8e1a7c30',
  reference: '7KQ2M9XDPA',
  amountRupees: 498,
};
const RAZORPAY_ORDER = {
  id: 'order_RB58MiP5SPFYyM',
  amountRupees: 498,
  currency: 'INR',
  receipt: '7KQ2M9XDPA',
  status: 'created' as const,
};
const PAYMENT_ID = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a101';
const REFUND_ID = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f101';
const NOW = new Date('2026-11-08T06:00:00.000Z');

function setup() {
  const prisma = {
    payment: {
      findUnique: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    refund: {
      findUnique: jest.fn().mockResolvedValue({
        razorpayPaymentId: 'pay_Late00000001',
        status: 'REQUESTED',
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ payment: { orderId: ORDER.orderId } }),
    },
    $transaction: jest.fn(),
  };
  // A refund's move and its email are one transaction: here, on the same
  // client, so the moves are seen on prisma.refund.
  prisma.$transaction.mockImplementation(
    (work: (client: typeof prisma) => unknown) => work(prisma),
  );
  const tx = {
    payment: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ razorpayPaymentId: null }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    refund: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: REFUND_ID }),
    },
  };
  const razorpay = {
    keyId: 'rzp_test_FakeKey0123',
    createOrder: jest.fn().mockResolvedValue(RAZORPAY_ORDER),
    findOrderByReceipt: jest.fn().mockResolvedValue(null),
    fetchPayment: jest.fn(),
    isCheckoutSignatureValid: jest.fn(),
    isWebhookSignatureValid: jest.fn(),
    orderPayments: jest.fn().mockResolvedValue([]),
    paymentRefunds: jest.fn().mockResolvedValue([]),
    refund: jest.fn().mockResolvedValue({
      id: 'rfnd_FP8QHiV938haTz',
      paymentId: 'pay_Late00000001',
      amountRupees: 498,
      status: 'pending',
    }),
  };
  const notifications = { queue: jest.fn().mockResolvedValue(undefined) };
  const logger = { warn: jest.fn(), error: jest.fn() };
  const service = new PaymentsService(
    prisma as unknown as PrismaService,
    razorpay as unknown as RazorpayGateway,
    notifications as unknown as NotificationsService,
    logger as unknown as PinoLogger,
  );
  return {
    service,
    prisma,
    tx: tx as unknown as Prisma.TransactionClient,
    txMock: tx,
    razorpay,
    notifications,
    logger,
  };
}

describe('PaymentsService', () => {
  it('gives the key ID the app opens the payment page with', () => {
    expect(setup().service.keyId).toBe('rzp_test_FakeKey0123');
  });

  describe('razorpayOrderFor', () => {
    it('answers the saved Razorpay order, without asking Razorpay', async () => {
      const { service, prisma, razorpay } = setup();
      prisma.payment.findUnique.mockResolvedValueOnce({
        razorpayOrderId: 'order_Saved00001',
      });

      await expect(service.razorpayOrderFor(ORDER)).resolves.toBe(
        'order_Saved00001',
      );
      expect(prisma.payment.findUnique).toHaveBeenCalledWith({
        where: { orderId: ORDER.orderId },
        select: { razorpayOrderId: true },
      });
      expect(razorpay.createOrder).not.toHaveBeenCalled();
      expect(prisma.payment.createMany).not.toHaveBeenCalled();
    });

    it('makes a Razorpay order for the total, with our reference as its receipt, and saves it', async () => {
      const { service, prisma, razorpay } = setup();
      prisma.payment.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ razorpayOrderId: RAZORPAY_ORDER.id });

      await expect(service.razorpayOrderFor(ORDER)).resolves.toBe(
        RAZORPAY_ORDER.id,
      );
      expect(razorpay.createOrder).toHaveBeenCalledWith({
        amountRupees: 498,
        receipt: '7KQ2M9XDPA',
        notes: { orderId: ORDER.orderId, reference: '7KQ2M9XDPA' },
      });
      expect(prisma.payment.createMany).toHaveBeenCalledWith({
        data: [
          {
            orderId: ORDER.orderId,
            razorpayOrderId: RAZORPAY_ORDER.id,
            amountRupees: 498,
          },
        ],
        skipDuplicates: true,
      });
      expect(razorpay.findOrderByReceipt).not.toHaveBeenCalled();
    });

    it('answers the row another request saved a moment before: the saved row wins', async () => {
      const { service, prisma } = setup();
      prisma.payment.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ razorpayOrderId: 'order_FirstOne01' });
      prisma.payment.createMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.razorpayOrderFor(ORDER)).resolves.toBe(
        'order_FirstOne01',
      );
    });

    it('finds the order Razorpay already made when it refuses the receipt a second time', async () => {
      const { service, prisma, razorpay } = setup();
      prisma.payment.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ razorpayOrderId: 'order_MadeBefore' });
      razorpay.createOrder.mockRejectedValueOnce(
        new RazorpayError(400, 'BAD_REQUEST_ERROR', 'Duplicate request'),
      );
      razorpay.findOrderByReceipt.mockResolvedValueOnce({
        ...RAZORPAY_ORDER,
        id: 'order_MadeBefore',
      });

      await expect(service.razorpayOrderFor(ORDER)).resolves.toBe(
        'order_MadeBefore',
      );
      expect(razorpay.findOrderByReceipt).toHaveBeenCalledWith('7KQ2M9XDPA');
      expect(prisma.payment.createMany).toHaveBeenCalledWith({
        data: [
          {
            orderId: ORDER.orderId,
            razorpayOrderId: 'order_MadeBefore',
            amountRupees: 498,
          },
        ],
        skipDuplicates: true,
      });
    });

    it("passes Razorpay's refusal on when no order has the receipt", async () => {
      const { service, prisma, razorpay } = setup();
      const refusal = new RazorpayError(
        400,
        'BAD_REQUEST_ERROR',
        'The amount must be at least INR 1.00',
      );
      razorpay.createOrder.mockRejectedValueOnce(refusal);

      await expect(service.razorpayOrderFor(ORDER)).rejects.toBe(refusal);
      expect(prisma.payment.createMany).not.toHaveBeenCalled();
    });

    it('passes other failures on without looking for the receipt', async () => {
      const { service, prisma, razorpay } = setup();
      for (const failure of [
        new RazorpayError(null, null, 'Razorpay could not be reached'),
        new RazorpayError(500, 'SERVER_ERROR', 'Something went wrong'),
        new RazorpayError(401, 'BAD_REQUEST_ERROR', 'Authentication failed'),
      ]) {
        razorpay.createOrder.mockRejectedValueOnce(failure);
        await expect(service.razorpayOrderFor(ORDER)).rejects.toBe(failure);
      }
      expect(razorpay.findOrderByReceipt).not.toHaveBeenCalled();
      expect(prisma.payment.createMany).not.toHaveBeenCalled();
    });

    it('never saves a Razorpay order for another amount or currency', async () => {
      for (const other of [
        { ...RAZORPAY_ORDER, amountRupees: 499 },
        { ...RAZORPAY_ORDER, amountRupees: null },
        { ...RAZORPAY_ORDER, currency: 'USD' },
      ]) {
        const { service, prisma, razorpay } = setup();
        razorpay.createOrder.mockResolvedValueOnce(other);

        await expect(service.razorpayOrderFor(ORDER)).rejects.toThrow(
          'Razorpay has an order with this receipt for another amount',
        );
        expect(prisma.payment.createMany).not.toHaveBeenCalled();
      }
    });

    it('fails when the row is not there after saving', async () => {
      const { service } = setup();

      await expect(service.razorpayOrderFor(ORDER)).rejects.toThrow(
        'The payment was not saved',
      );
    });
  });

  it('finds the Razorpay order an order is paid with, or null before paying starts', async () => {
    const { service, prisma } = setup();
    prisma.payment.findUnique.mockResolvedValueOnce({
      razorpayOrderId: 'order_Saved00001',
    });

    await expect(service.razorpayOrderOf(ORDER.orderId)).resolves.toBe(
      'order_Saved00001',
    );
    expect(prisma.payment.findUnique).toHaveBeenCalledWith({
      where: { orderId: ORDER.orderId },
      select: { razorpayOrderId: true },
    });
    await expect(service.razorpayOrderOf(ORDER.orderId)).resolves.toBeNull();
  });

  it("asks the gateway whether the payment page's signature is Razorpay's", () => {
    const { service, razorpay } = setup();
    razorpay.isCheckoutSignatureValid
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    expect(
      service.isCheckoutSignatureValid('order_A1', 'pay_A1', 'signature'),
    ).toBe(true);
    expect(razorpay.isCheckoutSignatureValid).toHaveBeenCalledWith(
      'order_A1',
      'pay_A1',
      'signature',
    );
    expect(
      service.isCheckoutSignatureValid('order_A1', 'pay_A1', 'signature'),
    ).toBe(false);
  });

  describe('summaryFor', () => {
    it('shows when the order was paid, and its refunds oldest first, without Razorpay IDs', async () => {
      const { service, prisma } = setup();
      const summary = {
        paidAt: NOW,
        refunds: [
          {
            amountRupees: 498,
            reason: 'ALREADY_PAID',
            status: 'PENDING',
            createdAt: NOW,
          },
        ],
      };
      prisma.payment.findUnique.mockResolvedValueOnce(summary);

      await expect(service.summaryFor(ORDER.orderId)).resolves.toEqual(summary);
      expect(prisma.payment.findUnique).toHaveBeenCalledWith({
        where: { orderId: ORDER.orderId },
        select: {
          paidAt: true,
          refunds: {
            orderBy: { createdAt: 'asc' },
            select: {
              amountRupees: true,
              reason: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });
    });

    it('answers null before paying starts', async () => {
      const { service } = setup();

      await expect(service.summaryFor(ORDER.orderId)).resolves.toBeNull();
    });
  });

  describe('refundInFull', () => {
    it("saves the paid order's payment as going back in full, for the reason given", async () => {
      const { service, tx, txMock } = setup();
      txMock.payment.findUniqueOrThrow.mockResolvedValueOnce({
        id: PAYMENT_ID,
        razorpayPaymentId: 'pay_G3P9vcIhRs3NV4',
        amountRupees: 498,
      });

      await expect(
        service.refundInFull(tx, ORDER.orderId, 'CANCELLED_BY_CUSTOMER'),
      ).resolves.toBe(REFUND_ID);
      expect(txMock.payment.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { orderId: ORDER.orderId },
        select: { id: true, razorpayPaymentId: true, amountRupees: true },
      });
      expect(txMock.refund.create).toHaveBeenCalledWith({
        data: {
          paymentId: PAYMENT_ID,
          razorpayPaymentId: 'pay_G3P9vcIhRs3NV4',
          amountRupees: 498,
          reason: 'CANCELLED_BY_CUSTOMER',
        },
        select: { id: true },
      });
    });

    it('refuses an order that was never paid, saving nothing', async () => {
      const { service, tx, txMock } = setup();
      txMock.payment.findUniqueOrThrow.mockResolvedValueOnce({
        id: PAYMENT_ID,
        razorpayPaymentId: null,
        amountRupees: 498,
      });

      await expect(
        service.refundInFull(tx, ORDER.orderId, 'CANCELLED_BY_STAFF'),
      ).rejects.toThrow('The order was never paid');
      expect(txMock.refund.create).not.toHaveBeenCalled();
    });
  });

  describe('staffPaymentFor', () => {
    it("shows a Super User the payment with Razorpay's IDs, and every refund oldest first", async () => {
      const { service, prisma } = setup();
      const payment = { razorpayOrderId: 'order_RB58MiP5SPFYyM', refunds: [] };
      prisma.payment.findUnique.mockResolvedValueOnce(payment);

      await expect(service.staffPaymentFor(ORDER.orderId)).resolves.toBe(
        payment,
      );
      expect(prisma.payment.findUnique).toHaveBeenCalledWith({
        where: { orderId: ORDER.orderId },
        select: {
          razorpayOrderId: true,
          razorpayPaymentId: true,
          amountRupees: true,
          paidAt: true,
          createdAt: true,
          refunds: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              razorpayPaymentId: true,
              razorpayRefundId: true,
              amountRupees: true,
              reason: true,
              status: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });
    });

    it('answers null before paying starts', async () => {
      const { service } = setup();

      await expect(service.staffPaymentFor(ORDER.orderId)).resolves.toBeNull();
    });
  });

  describe('listRefunds', () => {
    const refund = (id: string, orderId: string) => ({
      id,
      razorpayPaymentId: 'pay_Late00000001',
      razorpayRefundId: null,
      amountRupees: 498,
      reason: 'ORDER_CANCELLED',
      status: 'FAILED',
      createdAt: NOW,
      updatedAt: NOW,
      payment: { orderId },
    });

    it('lists the refunds in one status, the newest first, each naming its order, with the next page', async () => {
      const { service, prisma } = setup();
      prisma.refund.findMany.mockResolvedValueOnce([
        refund('r3', 'order-3'),
        refund('r2', 'order-2'),
        refund('r1', 'order-1'),
      ]);

      const page = await service.listRefunds({
        limit: 2,
        after: REFUND_ID,
        status: 'FAILED',
      });

      expect(page.refunds.map((r) => [r.id, r.orderId])).toEqual([
        ['r3', 'order-3'],
        ['r2', 'order-2'],
      ]);
      expect(page.refunds[0]).not.toHaveProperty('payment');
      expect(page.nextAfter).toBe('r2');
      expect(prisma.refund.findMany).toHaveBeenCalledWith({
        where: { status: 'FAILED' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
        cursor: { id: REFUND_ID },
        skip: 1,
        select: {
          id: true,
          razorpayPaymentId: true,
          razorpayRefundId: true,
          amountRupees: true,
          reason: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          payment: { select: { orderId: true } },
        },
      });
    });

    it('lists every refund from the first page when nothing is asked, and knows a full last page', async () => {
      const { service, prisma } = setup();
      prisma.refund.findMany.mockResolvedValueOnce([refund('r1', 'order-1')]);

      const page = await service.listRefunds({ limit: 1 });

      expect(page.nextAfter).toBeNull();
      expect(page.refunds).toHaveLength(1);
      const query = prisma.refund.findMany.mock.calls[0][0];
      expect(query.where).toEqual({ status: undefined });
      expect(query.take).toBe(2);
      expect(query).not.toHaveProperty('cursor');
      expect(query).not.toHaveProperty('skip');
    });
  });

  it("asks the gateway whether a webhook is Razorpay's", () => {
    const { service, razorpay } = setup();
    const body = Buffer.from('{}');
    razorpay.isWebhookSignatureValid.mockReturnValueOnce(true);

    expect(service.isWebhookSignatureValid(body, 'signature')).toBe(true);
    expect(razorpay.isWebhookSignatureValid).toHaveBeenCalledWith(
      body,
      'signature',
    );
  });

  describe('refundChanged', () => {
    const change = {
      razorpayRefundId: 'rfnd_FP8QHiV938haTz',
      receipt: REFUND_ID,
      status: 'processed' as const,
    };

    it('finds our refund by Razorpay ID or by its receipt, and moves it forward', async () => {
      const { service, prisma } = setup();
      prisma.refund.findFirst.mockResolvedValueOnce({
        id: REFUND_ID,
        status: 'REQUESTED',
        razorpayRefundId: null,
      });

      await service.refundChanged(change);

      expect(prisma.refund.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ razorpayRefundId: 'rfnd_FP8QHiV938haTz' }, { id: REFUND_ID }],
        },
        select: { id: true, status: true, razorpayRefundId: true },
      });
      expect(prisma.refund.updateMany).toHaveBeenCalledWith({
        where: { id: REFUND_ID, status: 'REQUESTED' },
        data: {
          status: 'PROCESSED',
          razorpayRefundId: 'rfnd_FP8QHiV938haTz',
        },
      });
    });

    it('moves a pending refund to processed or failed', async () => {
      for (const [said, saved] of [
        ['processed', 'PROCESSED'],
        ['failed', 'FAILED'],
      ] as const) {
        const { service, prisma } = setup();
        prisma.refund.findFirst.mockResolvedValueOnce({
          id: REFUND_ID,
          status: 'PENDING',
          razorpayRefundId: 'rfnd_FP8QHiV938haTz',
        });

        await service.refundChanged({ ...change, status: said });

        expect(prisma.refund.updateMany).toHaveBeenCalledWith({
          where: { id: REFUND_ID, status: 'PENDING' },
          data: { status: saved, razorpayRefundId: 'rfnd_FP8QHiV938haTz' },
        });
      }
    });

    it('never moves a refund back, or sideways, and ignores an old webhook', async () => {
      for (const [stored, said] of [
        ['PENDING', 'pending'],
        ['PROCESSED', 'pending'],
        ['PROCESSED', 'failed'],
        ['FAILED', 'processed'],
      ] as const) {
        const { service, prisma } = setup();
        prisma.refund.findFirst.mockResolvedValueOnce({
          id: REFUND_ID,
          status: stored,
          razorpayRefundId: 'rfnd_FP8QHiV938haTz',
        });

        await service.refundChanged({ ...change, status: said });

        expect(prisma.refund.updateMany).not.toHaveBeenCalled();
      }
    });

    it('never puts another Razorpay refund on a refund that has one', async () => {
      const { service, prisma } = setup();
      prisma.refund.findFirst.mockResolvedValueOnce({
        id: REFUND_ID,
        status: 'PENDING',
        razorpayRefundId: 'rfnd_Other000001',
      });

      await service.refundChanged(change);

      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
    });

    it('looks by Razorpay ID alone when the receipt is not one of ours, and changes nothing for a refund not ours', async () => {
      for (const receipt of [null, 'not-a-uuid']) {
        const { service, prisma } = setup();

        await service.refundChanged({ ...change, receipt });

        expect(prisma.refund.findFirst).toHaveBeenCalledWith({
          where: { OR: [{ razorpayRefundId: 'rfnd_FP8QHiV938haTz' }] },
          select: { id: true, status: true, razorpayRefundId: true },
        });
        expect(prisma.refund.updateMany).not.toHaveBeenCalled();
      }
    });
  });

  it('finds the Razorpay orders of the orders that started paying', async () => {
    const { service, prisma } = setup();
    const started = [
      { orderId: ORDER.orderId, razorpayOrderId: 'order_RB58MiP5SPFYyM' },
    ];
    prisma.payment.findMany.mockResolvedValueOnce(started);

    await expect(
      service.razorpayOrdersOf([ORDER.orderId, 'another-order']),
    ).resolves.toEqual(started);
    expect(prisma.payment.findMany).toHaveBeenCalledWith({
      where: { orderId: { in: [ORDER.orderId, 'another-order'] } },
      select: { orderId: true, razorpayOrderId: true },
    });
  });

  it('finds the payments Razorpay captured for one of its orders, and only those', async () => {
    const { service, razorpay } = setup();
    razorpay.orderPayments.mockResolvedValueOnce([
      { id: 'pay_Failed000001', status: 'failed' },
      { id: 'pay_Captured0001', status: 'captured' },
      { id: 'pay_Authorized01', status: 'authorized' },
    ]);

    await expect(
      service.capturedPaymentsOf('order_RB58MiP5SPFYyM'),
    ).resolves.toEqual(['pay_Captured0001']);
    expect(razorpay.orderPayments).toHaveBeenCalledWith('order_RB58MiP5SPFYyM');
  });

  it('asks Razorpay how a payment stands', async () => {
    const { service, razorpay } = setup();
    razorpay.fetchPayment.mockResolvedValueOnce({ id: 'pay_A1' });

    await expect(service.razorpayPayment('pay_A1')).resolves.toEqual({
      id: 'pay_A1',
    });
    expect(razorpay.fetchPayment).toHaveBeenCalledWith('pay_A1');
  });

  it('finds our payment by its Razorpay order', async () => {
    const { service, prisma } = setup();
    const record = {
      id: PAYMENT_ID,
      orderId: ORDER.orderId,
      amountRupees: 498,
    };
    prisma.payment.findUnique.mockResolvedValueOnce(record);

    await expect(
      service.forRazorpayOrder('order_RB58MiP5SPFYyM'),
    ).resolves.toEqual(record);
    expect(prisma.payment.findUnique).toHaveBeenCalledWith({
      where: { razorpayOrderId: 'order_RB58MiP5SPFYyM' },
      select: { id: true, orderId: true, amountRupees: true },
    });
  });

  describe('settlementState', () => {
    it('says which Razorpay payment paid the payment, and whether this one is being given back', async () => {
      const { service, tx, txMock } = setup();
      txMock.payment.findUniqueOrThrow.mockResolvedValueOnce({
        razorpayPaymentId: 'pay_First000001',
      });
      txMock.refund.findUnique.mockResolvedValueOnce({ id: REFUND_ID });

      await expect(
        service.settlementState(tx, PAYMENT_ID, 'pay_Second00001'),
      ).resolves.toEqual({ paidBy: 'pay_First000001', refunded: true });
      expect(txMock.payment.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: PAYMENT_ID },
        select: { razorpayPaymentId: true },
      });
      expect(txMock.refund.findUnique).toHaveBeenCalledWith({
        where: { razorpayPaymentId: 'pay_Second00001' },
        select: { id: true },
      });
    });

    it('says not paid and not refunded for a new payment', async () => {
      const { service, tx } = setup();

      await expect(
        service.settlementState(tx, PAYMENT_ID, 'pay_First000001'),
      ).resolves.toEqual({ paidBy: null, refunded: false });
    });
  });

  describe('markPaid', () => {
    it('records the Razorpay payment that paid, and when, only on an unpaid payment', async () => {
      const { service, tx, txMock } = setup();

      await service.markPaid(tx, PAYMENT_ID, 'pay_First000001', NOW);

      expect(txMock.payment.updateMany).toHaveBeenCalledWith({
        where: { id: PAYMENT_ID, razorpayPaymentId: null },
        data: { razorpayPaymentId: 'pay_First000001', paidAt: NOW },
      });
    });

    it('fails when the payment was paid already', async () => {
      const { service, tx, txMock } = setup();
      txMock.payment.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.markPaid(tx, PAYMENT_ID, 'pay_First000001', NOW),
      ).rejects.toThrow('The payment was paid already');
    });
  });

  it('records a refund in the transaction, and answers its ID', async () => {
    const { service, tx, txMock, razorpay } = setup();
    const refund = {
      paymentId: PAYMENT_ID,
      razorpayPaymentId: 'pay_Late00000001',
      amountRupees: 498,
      reason: 'ORDER_EXPIRED' as const,
    };

    await expect(service.recordRefund(tx, refund)).resolves.toBe(REFUND_ID);
    expect(txMock.refund.create).toHaveBeenCalledWith({
      data: refund,
      select: { id: true },
    });
    expect(razorpay.refund).not.toHaveBeenCalled();
  });

  describe('requestRefund', () => {
    it('asks Razorpay with our refund as its receipt, and saves what Razorpay answered', async () => {
      for (const [answered, saved] of [
        ['pending', 'PENDING'],
        ['processed', 'PROCESSED'],
        ['failed', 'FAILED'],
      ] as const) {
        const { service, prisma, razorpay } = setup();
        razorpay.refund.mockResolvedValueOnce({
          id: 'rfnd_FP8QHiV938haTz',
          paymentId: 'pay_Late00000001',
          amountRupees: 498,
          status: answered,
        });

        await service.requestRefund(REFUND_ID);

        expect(prisma.refund.findUnique).toHaveBeenCalledWith({
          where: { id: REFUND_ID },
          select: { razorpayPaymentId: true, status: true },
        });
        expect(razorpay.refund).toHaveBeenCalledWith(
          'pay_Late00000001',
          REFUND_ID,
        );
        expect(prisma.refund.updateMany).toHaveBeenCalledWith({
          where: { id: REFUND_ID, status: 'REQUESTED' },
          data: { status: saved, razorpayRefundId: 'rfnd_FP8QHiV938haTz' },
        });
      }
    });

    it('asks nothing for an unknown refund, or one Razorpay has already taken', async () => {
      for (const found of [
        null,
        { razorpayPaymentId: 'pay_Late00000001', status: 'PENDING' },
        { razorpayPaymentId: 'pay_Late00000001', status: 'PROCESSED' },
      ]) {
        const { service, prisma, razorpay } = setup();
        prisma.refund.findUnique.mockResolvedValueOnce(found);

        await service.requestRefund(REFUND_ID);

        expect(razorpay.refund).not.toHaveBeenCalled();
        expect(prisma.refund.updateMany).not.toHaveBeenCalled();
      }
    });

    it('leaves the refund REQUESTED when Razorpay fails, logs only its status and code, and never throws', async () => {
      const { service, prisma, razorpay, logger } = setup();
      razorpay.refund.mockRejectedValueOnce(
        new RazorpayError(null, null, 'Razorpay could not be reached'),
      );

      await expect(service.requestRefund(REFUND_ID)).resolves.toBeUndefined();

      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { refundId: REFUND_ID, status: null, code: null },
        'A refund was not taken yet: it is asked again later',
      );
    });

    it('finds the refund Razorpay already made, when it refuses our receipt a second time', async () => {
      const { service, prisma, razorpay, logger } = setup();
      razorpay.refund.mockRejectedValueOnce(
        new RazorpayError(400, 'BAD_REQUEST_ERROR', 'Duplicate request'),
      );
      razorpay.paymentRefunds.mockResolvedValueOnce([
        {
          id: 'rfnd_Someone00001',
          paymentId: 'pay_Late00000001',
          amountRupees: 498,
          receipt: 'another-receipt',
          status: 'processed',
        },
        {
          id: 'rfnd_FP8QHiV938haTz',
          paymentId: 'pay_Late00000001',
          amountRupees: 498,
          receipt: REFUND_ID,
          status: 'processed',
        },
      ]);

      await service.requestRefund(REFUND_ID);

      expect(razorpay.paymentRefunds).toHaveBeenCalledWith('pay_Late00000001');
      expect(prisma.refund.updateMany).toHaveBeenCalledWith({
        where: { id: REFUND_ID, status: 'REQUESTED' },
        data: { status: 'PROCESSED', razorpayRefundId: 'rfnd_FP8QHiV938haTz' },
      });
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('fails a refund Razorpay refuses outright, for staff to give the money back', async () => {
      const { service, prisma, razorpay, logger } = setup();
      razorpay.refund.mockRejectedValueOnce(
        new RazorpayError(
          400,
          'BAD_REQUEST_ERROR',
          'The refund amount exceeds the balance',
        ),
      );

      await service.requestRefund(REFUND_ID);

      expect(prisma.refund.updateMany).toHaveBeenCalledWith({
        where: { id: REFUND_ID, status: 'REQUESTED' },
        data: { status: 'FAILED' },
      });
      expect(logger.error).toHaveBeenCalledWith(
        { refundId: REFUND_ID, code: 'BAD_REQUEST_ERROR' },
        'Razorpay refused a refund: staff must give the money back',
      );
    });

    it('leaves the refund REQUESTED when Razorpay cannot even be asked about it', async () => {
      const { service, prisma, razorpay, logger } = setup();
      razorpay.refund.mockRejectedValueOnce(
        new RazorpayError(400, 'BAD_REQUEST_ERROR', 'Duplicate request'),
      );
      razorpay.paymentRefunds.mockRejectedValueOnce(
        new RazorpayError(null, null, 'Razorpay could not be reached'),
      );

      await expect(service.requestRefund(REFUND_ID)).resolves.toBeUndefined();

      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        { refundId: REFUND_ID, status: 400, code: 'BAD_REQUEST_ERROR' },
        'A refund was not taken yet: it is asked again later',
      );
    });

    it('logs only the name of any other failure', async () => {
      const { service, prisma, logger } = setup();
      prisma.refund.updateMany.mockRejectedValueOnce(
        new TypeError('the database is down'),
      );

      await expect(service.requestRefund(REFUND_ID)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        { refundId: REFUND_ID, errorName: 'TypeError' },
        'A refund was not taken yet: it is asked again later',
      );
    });
  });

  describe('retryRefunds', () => {
    it('asks again for refunds not taken, a minute after they were made, the oldest first', async () => {
      const { service, prisma, razorpay } = setup();
      prisma.refund.findMany.mockResolvedValueOnce([
        { id: REFUND_ID, razorpayPaymentId: 'pay_Late00000001' },
        {
          id: 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f202',
          razorpayPaymentId: 'pay_Late00000002',
        },
        {
          id: 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f303',
          razorpayPaymentId: 'pay_Late00000003',
        },
      ]);
      razorpay.refund
        .mockResolvedValueOnce({
          id: 'rfnd_FP8QHiV938haTz',
          paymentId: 'pay_Late00000001',
          amountRupees: 498,
          receipt: REFUND_ID,
          status: 'pending',
        })
        // Razorpay refuses the second outright.
        .mockRejectedValueOnce(
          new RazorpayError(400, 'BAD_REQUEST_ERROR', 'Refund not allowed'),
        )
        // Razorpay made the third earlier, but our request lost its answer.
        .mockRejectedValueOnce(
          new RazorpayError(400, 'BAD_REQUEST_ERROR', 'Duplicate request'),
        );
      razorpay.paymentRefunds.mockImplementation((paymentId: string) =>
        Promise.resolve(
          paymentId === 'pay_Late00000003'
            ? [
                {
                  id: 'rfnd_FP8QHiV938haUa',
                  paymentId: 'pay_Late00000003',
                  amountRupees: 498,
                  receipt: 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f303',
                  status: 'processed',
                },
              ]
            : [],
        ),
      );

      await expect(service.retryRefunds(NOW)).resolves.toEqual({
        taken: 2,
        notTaken: 1,
      });
      expect(prisma.refund.findMany).toHaveBeenCalledWith({
        where: {
          status: 'REQUESTED',
          createdAt: { lte: new Date('2026-11-08T05:59:00.000Z') },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: { id: true, razorpayPaymentId: true },
      });
      expect(razorpay.refund.mock.calls).toEqual([
        ['pay_Late00000001', REFUND_ID],
        ['pay_Late00000002', 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f202'],
        ['pay_Late00000003', 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f303'],
      ]);
      expect(prisma.refund.updateMany.mock.calls).toEqual([
        [
          {
            where: { id: REFUND_ID, status: 'REQUESTED' },
            data: {
              status: 'PENDING',
              razorpayRefundId: 'rfnd_FP8QHiV938haTz',
            },
          },
        ],
        [
          {
            where: {
              id: 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f202',
              status: 'REQUESTED',
            },
            data: { status: 'FAILED' },
          },
        ],
        [
          {
            where: {
              id: 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f303',
              status: 'REQUESTED',
            },
            data: {
              status: 'PROCESSED',
              razorpayRefundId: 'rfnd_FP8QHiV938haUa',
            },
          },
        ],
      ]);
    });

    it('asks nothing when no refund waits', async () => {
      const { service, razorpay } = setup();

      await expect(service.retryRefunds(NOW)).resolves.toEqual({
        taken: 0,
        notTaken: 0,
      });
      expect(razorpay.refund).not.toHaveBeenCalled();
    });
  });

  describe('the email that tells of a refund (ADR 0029)', () => {
    const answer = (status: 'pending' | 'processed' | 'failed') => ({
      id: 'rfnd_FP8QHiV938haTz',
      paymentId: 'pay_Late00000001',
      amountRupees: 498,
      status,
    });

    it('is saved with the move when Razorpay answers that the money is back, or cannot be', async () => {
      for (const [said, kind] of [
        ['processed', 'REFUND_PROCESSED'],
        ['failed', 'REFUND_FAILED'],
      ] as const) {
        const { service, prisma, razorpay, notifications } = setup();
        razorpay.refund.mockResolvedValueOnce(answer(said));

        await service.requestRefund(REFUND_ID);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(prisma.refund.findUniqueOrThrow).toHaveBeenCalledWith({
          where: { id: REFUND_ID },
          select: { payment: { select: { orderId: true } } },
        });
        expect(notifications.queue).toHaveBeenCalledWith(prisma, {
          kind,
          orderId: ORDER.orderId,
          refundId: REFUND_ID,
        });
        expect(
          prisma.refund.updateMany.mock.invocationCallOrder[0] <
            notifications.queue.mock.invocationCallOrder[0],
        ).toBe(true);
      }
    });

    it('is not saved while the money is still on its way, or when the refund had moved already', async () => {
      const pending = setup();
      pending.razorpay.refund.mockResolvedValueOnce(answer('pending'));
      await pending.service.requestRefund(REFUND_ID);
      expect(pending.prisma.refund.updateMany).toHaveBeenCalledTimes(1);
      expect(pending.prisma.refund.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(pending.notifications.queue).not.toHaveBeenCalled();

      const moved = setup();
      moved.razorpay.refund.mockResolvedValueOnce(answer('processed'));
      moved.prisma.refund.updateMany.mockResolvedValueOnce({ count: 0 });
      await moved.service.requestRefund(REFUND_ID);
      expect(moved.notifications.queue).not.toHaveBeenCalled();
    });

    it('tells the Super Users of a refund Razorpay refuses outright', async () => {
      const { service, prisma, razorpay, notifications } = setup();
      razorpay.refund.mockRejectedValueOnce(
        new RazorpayError(400, 'BAD_REQUEST_ERROR', 'Refund not allowed'),
      );

      await service.requestRefund(REFUND_ID);

      expect(notifications.queue).toHaveBeenCalledWith(prisma, {
        kind: 'REFUND_FAILED',
        orderId: ORDER.orderId,
        refundId: REFUND_ID,
      });
    });

    it('tells what a webhook reports: given back or failed, and nothing while pending', async () => {
      for (const [stored, said, kind] of [
        ['PENDING', 'processed', 'REFUND_PROCESSED'],
        ['PENDING', 'failed', 'REFUND_FAILED'],
        ['REQUESTED', 'pending', null],
      ] as const) {
        const { service, prisma, notifications } = setup();
        prisma.refund.findFirst.mockResolvedValueOnce({
          id: REFUND_ID,
          status: stored,
          razorpayRefundId: null,
        });

        await service.refundChanged({
          razorpayRefundId: 'rfnd_FP8QHiV938haTz',
          receipt: REFUND_ID,
          status: said,
        });

        if (kind) {
          expect(notifications.queue).toHaveBeenCalledWith(prisma, {
            kind,
            orderId: ORDER.orderId,
            refundId: REFUND_ID,
          });
        } else {
          expect(notifications.queue).not.toHaveBeenCalled();
        }
      }
    });

    it('moves the refund inside the transaction, and fails the webhook when the email is refused, so Razorpay sends it again', async () => {
      const { service, prisma, notifications } = setup();
      const tx = {
        refund: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ payment: { orderId: ORDER.orderId } }),
        },
      };
      prisma.$transaction.mockImplementation(
        (work: (client: typeof tx) => unknown) => work(tx),
      );
      prisma.refund.findFirst.mockResolvedValue({
        id: REFUND_ID,
        status: 'PENDING',
        razorpayRefundId: 'rfnd_FP8QHiV938haTz',
      });
      const change = {
        razorpayRefundId: 'rfnd_FP8QHiV938haTz',
        receipt: REFUND_ID,
        status: 'processed' as const,
      };

      await service.refundChanged(change);

      expect(tx.refund.updateMany).toHaveBeenCalledWith({
        where: { id: REFUND_ID, status: 'PENDING' },
        data: { status: 'PROCESSED', razorpayRefundId: 'rfnd_FP8QHiV938haTz' },
      });
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
      expect(notifications.queue).toHaveBeenCalledWith(tx, {
        kind: 'REFUND_PROCESSED',
        orderId: ORDER.orderId,
        refundId: REFUND_ID,
      });

      const refused = new Error('the database refused the email');
      notifications.queue.mockRejectedValueOnce(refused);
      await expect(service.refundChanged(change)).rejects.toBe(refused);
    });
  });
});
