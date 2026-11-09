import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';
import type { RefundReason, RefundStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  RazorpayError,
  RazorpayGateway,
  type RazorpayOrder,
  type RazorpayPayment,
  type RazorpayRefund,
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

// What an order shows of its payment: when it was paid, and any money
// given back, with why and how far along it is. Razorpay's IDs stay inside.
export interface PaymentSummary {
  paidAt: Date | null;
  refunds: {
    amountRupees: number;
    reason: RefundReason;
    status: RefundStatus;
    createdAt: Date;
  }[];
}

// Razorpay's refund statuses, as ours.
const REFUND_STATUS = {
  pending: 'PENDING',
  processed: 'PROCESSED',
  failed: 'FAILED',
} as const satisfies Record<string, RefundStatus>;

// A refund Razorpay has not taken is asked again a minute after it was
// made, and at most this many in one run.
const RETRY_REFUNDS_AFTER_MS = 60 * 1000;
const RETRY_REFUNDS_PER_RUN = 50;

// How far along a refund is. Its status only moves forward, as the
// database insists.
const REFUND_STAGE = {
  REQUESTED: 0,
  PENDING: 1,
  PROCESSED: 2,
  FAILED: 2,
} as const satisfies Record<RefundStatus, number>;

// What a Razorpay webhook says about a refund.
export interface RefundChange {
  razorpayRefundId: string;
  // Our refund's ID, which we sent as the receipt.
  receipt: string | null;
  status: keyof typeof REFUND_STATUS;
}

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
    const saved = await this.razorpayOrderOf(order.orderId);
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
    const now = await this.razorpayOrderOf(order.orderId);
    if (!now) {
      throw new Error('The payment was not saved');
    }
    return now;
  }

  // The Razorpay order an order is paid with, or null before paying starts.
  async razorpayOrderOf(orderId: string): Promise<string | null> {
    const payment = await this.prisma.payment.findUnique({
      where: { orderId },
      select: { razorpayOrderId: true },
    });
    return payment?.razorpayOrderId ?? null;
  }

  // Whether what the payment page gave the app is really Razorpay's.
  isCheckoutSignatureValid(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    signature: string,
  ): boolean {
    return this.razorpay.isCheckoutSignatureValid(
      razorpayOrderId,
      razorpayPaymentId,
      signature,
    );
  }

  // Whether a webhook is really Razorpay's: its signature over the body
  // exactly as it arrived.
  isWebhookSignatureValid(
    rawBody: Buffer,
    signature: string | undefined,
  ): boolean {
    return this.razorpay.isWebhookSignatureValid(rawBody, signature);
  }

  // Applies what a Razorpay webhook says about one of our refunds. It is
  // found by Razorpay's refund ID, or by its receipt, our refund's ID, when
  // Razorpay's answer to our request never reached us. Its status only moves
  // forward, so an old or repeated webhook changes nothing.
  async refundChanged(change: RefundChange): Promise<void> {
    const ours: Prisma.RefundWhereInput[] = [
      { razorpayRefundId: change.razorpayRefundId },
    ];
    const receipt = z.uuid().safeParse(change.receipt);
    if (receipt.success) {
      ours.push({ id: receipt.data });
    }
    const refund = await this.prisma.refund.findFirst({
      where: { OR: ours },
      select: { id: true, status: true, razorpayRefundId: true },
    });
    if (!refund) {
      return;
    }
    const status = REFUND_STATUS[change.status];
    const otherRefund =
      refund.razorpayRefundId !== null &&
      refund.razorpayRefundId !== change.razorpayRefundId;
    if (otherRefund || REFUND_STAGE[status] <= REFUND_STAGE[refund.status]) {
      return;
    }
    await this.prisma.refund.updateMany({
      where: { id: refund.id, status: refund.status },
      data: { status, razorpayRefundId: change.razorpayRefundId },
    });
  }

  // What the customer sees of an order's payment, or null before paying
  // starts.
  summaryFor(orderId: string): Promise<PaymentSummary | null> {
    return this.prisma.payment.findUnique({
      where: { orderId },
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
  }

  // A payment as Razorpay knows it now: the only word on whether money came.
  razorpayPayment(razorpayPaymentId: string): Promise<RazorpayPayment> {
    return this.razorpay.fetchPayment(razorpayPaymentId);
  }

  // The Razorpay orders of the orders that started paying, among these.
  razorpayOrdersOf(
    orderIds: string[],
  ): Promise<{ orderId: string; razorpayOrderId: string }[]> {
    return this.prisma.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, razorpayOrderId: true },
    });
  }

  // The payments Razorpay has captured for one of its orders.
  async capturedPaymentsOf(razorpayOrderId: string): Promise<string[]> {
    const payments = await this.razorpay.orderPayments(razorpayOrderId);
    return payments
      .filter((payment) => payment.status === 'captured')
      .map((payment) => payment.id);
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
    await this.askForRefund(refundId, refund.razorpayPaymentId);
  }

  // Asks Razorpay again for the refunds it has not taken, the oldest first,
  // once each has waited a minute after it was made (its first request
  // comes from requestRefund). The expiry job calls it every minute.
  async retryRefunds(
    now = new Date(),
  ): Promise<{ taken: number; notTaken: number }> {
    const waiting = await this.prisma.refund.findMany({
      where: {
        status: 'REQUESTED',
        createdAt: { lte: new Date(now.getTime() - RETRY_REFUNDS_AFTER_MS) },
      },
      orderBy: { createdAt: 'asc' },
      take: RETRY_REFUNDS_PER_RUN,
      select: { id: true, razorpayPaymentId: true },
    });
    let taken = 0;
    for (const refund of waiting) {
      if (await this.askForRefund(refund.id, refund.razorpayPaymentId)) {
        taken += 1;
      }
    }
    return { taken, notTaken: waiting.length - taken };
  }

  // Asks Razorpay for one refund, and answers whether Razorpay has it now.
  // When Razorpay refuses, our earlier request may have reached it with its
  // answer lost: then Razorpay refuses the same receipt again, and the
  // refund is found among the payment's refunds. A refund Razorpay refuses
  // outright (400) fails, for staff to give the money back. Anything else
  // leaves it REQUESTED, to be asked again.
  private async askForRefund(
    refundId: string,
    razorpayPaymentId: string,
  ): Promise<boolean> {
    try {
      await this.saveTaken(
        refundId,
        await this.razorpay.refund(razorpayPaymentId, refundId),
      );
      return true;
    } catch (error) {
      try {
        const made = (
          await this.razorpay.paymentRefunds(razorpayPaymentId)
        ).find((refund) => refund.receipt === refundId);
        if (made) {
          await this.saveTaken(refundId, made);
          return true;
        }
        if (error instanceof RazorpayError && error.status === 400) {
          await this.prisma.refund.updateMany({
            where: { id: refundId, status: 'REQUESTED' },
            data: { status: 'FAILED' },
          });
          this.logger.error(
            { refundId, code: error.code },
            'Razorpay refused a refund: staff must give the money back',
          );
          return false;
        }
      } catch {
        // Razorpay or the database can't be asked now: asked again later.
      }
      this.logger.warn(
        error instanceof RazorpayError
          ? { refundId, status: error.status, code: error.code }
          : {
              refundId,
              errorName: error instanceof Error ? error.name : 'unknown',
            },
        'A refund was not taken yet: it is asked again later',
      );
      return false;
    }
  }

  private async saveTaken(
    refundId: string,
    taken: RazorpayRefund,
  ): Promise<void> {
    await this.prisma.refund.updateMany({
      where: { id: refundId, status: 'REQUESTED' },
      data: {
        status: REFUND_STATUS[taken.status],
        razorpayRefundId: taken.id,
      },
    });
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
