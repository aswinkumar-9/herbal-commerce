import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { Prisma } from '../generated/prisma/client';
import type { RefundReason, RefundStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  RazorpayError,
  RazorpayGateway,
  type RazorpayOrder,
  type RazorpayPayment,
} from './razorpay.gateway';

// What a payment is for: one of our orders, its reference and its total.
export interface PayableOrder {
  orderId: string;
  reference: string;
  amountRupees: number;
}

// Our payment for an order: the Razorpay order it is paid through.
export interface PaymentRecord {
  id: string;
  orderId: string;
  amountRupees: number;
}

// What our payment knows of one Razorpay payment, read in the transaction
// that settles it: which Razorpay payment paid it, if one has, and whether
// this one is being given back.
export interface SettlementState {
  paidBy: string | null;
  refunded: boolean;
}

// Razorpay's refund statuses, as ours.
const REFUND_STATUS = {
  pending: 'PENDING',
  processed: 'PROCESSED',
  failed: 'FAILED',
} as const satisfies Record<string, RefundStatus>;

// Payments and refunds (ADR 0027): the payments and refunds tables, and
// Razorpay behind them. The orders ask this service, never Razorpay or
// these tables.
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayGateway,
    @InjectPinoLogger(PaymentsService.name)
    private readonly logger: PinoLogger,
  ) {}

  // The key the app opens Razorpay's payment page with. Not secret.
  get keyId(): string {
    return this.razorpay.keyId;
  }

  // The Razorpay order an order is paid with: made the first time, then the
  // same one each time. Our reference is its receipt, which Razorpay takes
  // only once, so an order never gets two, even when two requests ask at the
  // same moment.
  async razorpayOrderFor(order: PayableOrder): Promise<string> {
    const saved = await this.savedRazorpayOrder(order.orderId);
    if (saved) {
      return saved;
    }
    const made = await this.makeOrFind(order);
    if (made.amountRupees !== order.amountRupees || made.currency !== 'INR') {
      throw new Error(
        'Razorpay has an order with this receipt for another amount',
      );
    }
    // Another request may have saved it a moment ago: then its row stays.
    await this.prisma.payment.createMany({
      data: [
        {
          orderId: order.orderId,
          razorpayOrderId: made.id,
          amountRupees: order.amountRupees,
        },
      ],
      skipDuplicates: true,
    });
    const now = await this.savedRazorpayOrder(order.orderId);
    if (!now) {
      throw new Error('The payment was not saved');
    }
    return now;
  }

  // A payment as Razorpay knows it now: the only word on whether money came.
  razorpayPayment(razorpayPaymentId: string): Promise<RazorpayPayment> {
    return this.razorpay.fetchPayment(razorpayPaymentId);
  }

  // Our payment for a Razorpay order, or null when the order is not ours.
  forRazorpayOrder(razorpayOrderId: string): Promise<PaymentRecord | null> {
    return this.prisma.payment.findUnique({
      where: { razorpayOrderId },
      select: { id: true, orderId: true, amountRupees: true },
    });
  }

  // Read in the transaction that settles a Razorpay payment, after the order
  // is locked, so what it says can't change before the transaction ends.
  async settlementState(
    tx: Prisma.TransactionClient,
    paymentId: string,
    razorpayPaymentId: string,
  ): Promise<SettlementState> {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { razorpayPaymentId: true },
    });
    const refund = await tx.refund.findUnique({
      where: { razorpayPaymentId },
      select: { id: true },
    });
    return { paidBy: payment.razorpayPaymentId, refunded: refund !== null };
  }

  // Records the Razorpay payment that paid the order. Only once: the
  // database never lets a paid payment change.
  async markPaid(
    tx: Prisma.TransactionClient,
    paymentId: string,
    razorpayPaymentId: string,
    now: Date,
  ): Promise<void> {
    const { count } = await tx.payment.updateMany({
      where: { id: paymentId, razorpayPaymentId: null },
      data: { razorpayPaymentId, paidAt: now },
    });
    if (count !== 1) {
      throw new Error('The payment was paid already');
    }
  }

  // Records that a Razorpay payment goes back in full, and why. Razorpay is
  // asked only after the transaction, by requestRefund.
  async recordRefund(
    tx: Prisma.TransactionClient,
    refund: {
      paymentId: string;
      razorpayPaymentId: string;
      amountRupees: number;
      reason: RefundReason;
    },
  ): Promise<string> {
    const saved = await tx.refund.create({
      data: refund,
      select: { id: true },
    });
    return saved.id;
  }

  // Asks Razorpay to give a recorded refund back, with our refund's ID as
  // its receipt, so a second request can never refund twice. If Razorpay
  // can't take it now, the refund stays REQUESTED and is asked again later.
  // It never throws: the money rules are already saved.
  async requestRefund(refundId: string): Promise<void> {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      select: { razorpayPaymentId: true, status: true },
    });
    if (!refund || refund.status !== 'REQUESTED') {
      return;
    }
    try {
      const taken = await this.razorpay.refund(
        refund.razorpayPaymentId,
        refundId,
      );
      await this.prisma.refund.updateMany({
        where: { id: refundId, status: 'REQUESTED' },
        data: {
          status: REFUND_STATUS[taken.status],
          razorpayRefundId: taken.id,
        },
      });
    } catch (error) {
      this.logger.warn(
        error instanceof RazorpayError
          ? { refundId, status: error.status, code: error.code }
          : {
              refundId,
              errorName: error instanceof Error ? error.name : 'unknown',
            },
        'A refund was not taken yet: it is asked again later',
      );
    }
  }

  private async savedRazorpayOrder(orderId: string): Promise<string | null> {
    const payment = await this.prisma.payment.findUnique({
      where: { orderId },
      select: { razorpayOrderId: true },
    });
    return payment?.razorpayOrderId ?? null;
  }

  // Razorpay refuses a second order with the same receipt. Then the first
  // one exists: it was made a moment ago, or its answer came too late to
  // be saved.
  private async makeOrFind(order: PayableOrder): Promise<RazorpayOrder> {
    try {
      return await this.razorpay.createOrder({
        amountRupees: order.amountRupees,
        receipt: order.reference,
        notes: { orderId: order.orderId, reference: order.reference },
      });
    } catch (error) {
      if (error instanceof RazorpayError && error.status === 400) {
        const found = await this.razorpay.findOrderByReceipt(order.reference);
        if (found) {
          return found;
        }
      }
      throw error;
    }
  }
}
