import type { PinoLogger } from 'nestjs-pino';
import type { Prisma } from '../generated/prisma/client';
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
    },
    refund: {
      findUnique: jest.fn().mockResolvedValue({
        razorpayPaymentId: 'pay_Late00000001',
        status: 'REQUESTED',
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
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
    refund: jest.fn().mockResolvedValue({
      id: 'rfnd_FP8QHiV938haTz',
      paymentId: 'pay_Late00000001',
      amountRupees: 498,
      status: 'pending',
    }),
  };
  const logger = { warn: jest.fn() };
  const service = new PaymentsService(
    prisma as unknown as PrismaService,
    razorpay as unknown as RazorpayGateway,
    logger as unknown as PinoLogger,
  );
  return {
    service,
    prisma,
    tx: tx as unknown as Prisma.TransactionClient,
    txMock: tx,
    razorpay,
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
});
