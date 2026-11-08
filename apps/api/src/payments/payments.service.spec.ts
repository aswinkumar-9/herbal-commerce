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

function setup() {
  const prisma = {
    payment: {
      findUnique: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const razorpay = {
    keyId: 'rzp_test_FakeKey0123',
    createOrder: jest.fn().mockResolvedValue(RAZORPAY_ORDER),
    findOrderByReceipt: jest.fn().mockResolvedValue(null),
  };
  const service = new PaymentsService(
    prisma as unknown as PrismaService,
    razorpay as unknown as RazorpayGateway,
  );
  return { service, prisma, razorpay };
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
});
