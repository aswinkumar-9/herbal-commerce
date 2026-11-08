import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { RetryLaterException } from '../common/retry-later.exception';
import type { Prisma } from '../generated/prisma/client';
import type { RefundReason } from '../generated/prisma/enums';
import { NotEnoughStockError, StockService } from '../inventory/stock.service';
import {
  PaymentsService,
  type PaymentRecord,
} from '../payments/payments.service';
import {
  RazorpayError,
  type RazorpayPayment,
} from '../payments/razorpay.gateway';
import { PrismaService } from '../prisma/prisma.service';
import {
  HOLD_OVER,
  NOT_PAYABLE,
  PAYMENT_NOT_STARTED,
  PAYMENT_NOT_VERIFIED,
  PAYMENTS_UNAVAILABLE,
} from './order-rules';
import type { ConfirmPaymentInput } from './orders.schemas';
import {
  EXPIRE_PER_RUN,
  ORDER_NOT_FOUND,
  OrdersService,
  type OrderView,
} from './orders.service';

// How long the app waits before asking again when Razorpay can't be
// reached.
const RETRY_PAYMENTS_SECONDS = 30;

// What the app needs to open Razorpay's payment page for an order, in
// rupees (ADR 0027). The page wants the amount in paise: the app multiplies
// totalRupees by 100 itself, by the owner's choice.
export interface PaymentStart {
  reference: string;
  totalRupees: number;
  holdExpiresAt: Date;
  razorpayKeyId: string;
  razorpayOrderId: string;
}

// What settling a Razorpay payment did (ADR 0027).
export type Settlement =
  // Not captured, so no money yet (authorized, created or failed): nothing
  // changes. A captured payment comes back later.
  | { kind: 'NOT_CAPTURED'; razorpayStatus: RazorpayPayment['status'] }
  // Not for one of our orders.
  | { kind: 'UNKNOWN_ORDER' }
  // Handled before: paid the order, or is being given back.
  | { kind: 'ALREADY_SETTLED'; orderId: string }
  // Paid the order. Late: after it expired, with its stock taken again.
  | { kind: 'PAID'; orderId: string; late: boolean }
  // Goes back to the customer in full, and why.
  | {
      kind: 'REFUNDING';
      orderId: string;
      reason: RefundReason;
      refundId: string;
    };

// Paying for orders (ADR 0027). An order asks the payments for its Razorpay
// order, and never reads their tables.
@Injectable()
export class OrderPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly stock: StockService,
    private readonly orders: OrdersService,
    @InjectPinoLogger(OrderPaymentsService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Starts paying for the customer's own order while it waits for payment
  // and its stock is still held. Asking again answers the same Razorpay
  // order, so a retried request does no harm.
  async start(
    userId: string,
    orderId: string,
    now = new Date(),
  ): Promise<PaymentStart> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: {
        id: true,
        reference: true,
        status: true,
        totalRupees: true,
        holdExpiresAt: true,
      },
    });
    if (!order) {
      throw new NotFoundException(ORDER_NOT_FOUND);
    }
    if (order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException(NOT_PAYABLE);
    }
    if (order.holdExpiresAt.getTime() <= now.getTime()) {
      throw new ConflictException(HOLD_OVER);
    }
    let razorpayOrderId: string;
    try {
      razorpayOrderId = await this.payments.razorpayOrderFor({
        orderId: order.id,
        reference: order.reference,
        amountRupees: order.totalRupees,
      });
    } catch (error) {
      return this.startFailed(userId, orderId, error);
    }
    return {
      reference: order.reference,
      totalRupees: order.totalRupees,
      holdExpiresAt: order.holdExpiresAt,
      razorpayKeyId: this.payments.keyId,
      razorpayOrderId,
    };
  }

  // Confirms a payment with what Razorpay's page gave the app. Razorpay's
  // signature must be right for this order's Razorpay order, and then
  // Razorpay itself is asked: the app's word alone never pays an order. The
  // answer is the order as it is now: paid, still waiting (a payment not
  // captured yet, or failed), or with its money on the way back.
  async confirm(
    userId: string,
    orderId: string,
    input: ConfirmPaymentInput,
  ): Promise<OrderView> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException(ORDER_NOT_FOUND);
    }
    const razorpayOrderId = await this.payments.razorpayOrderOf(orderId);
    if (!razorpayOrderId) {
      throw new ConflictException(PAYMENT_NOT_STARTED);
    }
    if (
      !this.payments.isCheckoutSignatureValid(
        razorpayOrderId,
        input.razorpayPaymentId,
        input.razorpaySignature,
      )
    ) {
      this.logger.warn({ orderId }, 'A payment came with a wrong signature');
      throw new BadRequestException(PAYMENT_NOT_VERIFIED);
    }
    let settlement: Settlement;
    try {
      settlement = await this.settle(input.razorpayPaymentId);
    } catch (error) {
      if (error instanceof RazorpayError) {
        throw this.unavailable(error, 'Razorpay could not confirm a payment');
      }
      throw error;
    }
    // The signature ties the payment to this order's Razorpay order, so
    // this never happens.
    if (
      settlement.kind === 'UNKNOWN_ORDER' ||
      (settlement.kind !== 'NOT_CAPTURED' && settlement.orderId !== orderId)
    ) {
      throw new BadRequestException(PAYMENT_NOT_VERIFIED);
    }
    return this.orders.view(userId, orderId);
  }

  // Settles a Razorpay payment: what Razorpay says now decides, never what
  // a client says. In one transaction, with the order locked, so a cancel or
  // an expiry at the same moment waits for it:
  // - an order waiting for payment is paid;
  // - an expired one is paid late if its stock can be taken again, from the
  //   batches that expire first; otherwise the payment goes back (the
  //   owner's rule);
  // - a cancelled one gives the payment back;
  // - a second payment for an order already paid goes back.
  // The same payment settled again changes nothing. Razorpay is asked for a
  // refund only once the transaction is saved.
  async settle(
    razorpayPaymentId: string,
    now = new Date(),
  ): Promise<Settlement> {
    const paid = await this.payments.razorpayPayment(razorpayPaymentId);
    if (paid.status !== 'captured') {
      return { kind: 'NOT_CAPTURED', razorpayStatus: paid.status };
    }
    const record = paid.orderId
      ? await this.payments.forRazorpayOrder(paid.orderId)
      : null;
    if (!record) {
      return { kind: 'UNKNOWN_ORDER' };
    }
    // Razorpay takes only its order's amount, so this never happens; if it
    // ever did, nothing is decided without a person.
    if (paid.amountRupees !== record.amountRupees || paid.currency !== 'INR') {
      throw new Error('A captured payment does not match its order');
    }
    const settlement = await this.prisma.$transaction((tx) =>
      this.settleLocked(tx, record, paid.id, now),
    );
    if (settlement.kind === 'REFUNDING') {
      await this.payments.requestRefund(settlement.refundId);
    }
    return settlement;
  }

  // Before the expiry job expires unpaid orders, asks Razorpay whether any
  // that started paying was paid in fact: its webhook may be late, or its
  // customer closed the app. Each captured payment found is settled, so the
  // order is paid instead of expiring. If Razorpay can't be asked about an
  // order, it expires anyway: a payment found later is settled by the
  // owner's rule for late payments. Answers how many payments were settled,
  // and how many orders could not be asked about.
  async collectDuePayments(
    now = new Date(),
  ): Promise<{ settled: number; failed: number }> {
    const due = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lte: now } },
      orderBy: { holdExpiresAt: 'asc' },
      take: EXPIRE_PER_RUN,
      select: { id: true },
    });
    if (due.length === 0) {
      return { settled: 0, failed: 0 };
    }
    const started = await this.payments.razorpayOrdersOf(
      due.map((order) => order.id),
    );
    let settled = 0;
    let failed = 0;
    for (const { razorpayOrderId } of started) {
      try {
        for (const paymentId of await this.payments.capturedPaymentsOf(
          razorpayOrderId,
        )) {
          await this.settle(paymentId, now);
          settled += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { settled, failed };
  }

  private async settleLocked(
    tx: Prisma.TransactionClient,
    record: PaymentRecord,
    razorpayPaymentId: string,
    now: Date,
  ): Promise<Settlement> {
    const orderId = record.orderId;
    // The lock: the order's row stays locked until the transaction ends.
    await tx.order.updateMany({
      where: { id: orderId },
      data: { updatedAt: now },
    });
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        status: true,
        items: {
          orderBy: { position: 'asc' },
          select: { variantId: true, packs: true },
        },
      },
    });
    const state = await this.payments.settlementState(
      tx,
      record.id,
      razorpayPaymentId,
    );
    if (state.paidBy === razorpayPaymentId || state.refunded) {
      return { kind: 'ALREADY_SETTLED', orderId };
    }
    const refund = async (reason: RefundReason): Promise<Settlement> => ({
      kind: 'REFUNDING',
      orderId,
      reason,
      refundId: await this.payments.recordRefund(tx, {
        paymentId: record.id,
        razorpayPaymentId,
        amountRupees: record.amountRupees,
        reason,
      }),
    });
    if (state.paidBy !== null) {
      return refund('ALREADY_PAID');
    }
    if (order.status === 'PENDING_PAYMENT') {
      await this.markOrderPaid(
        tx,
        record,
        razorpayPaymentId,
        order.status,
        now,
      );
      return { kind: 'PAID', orderId, late: false };
    }
    if (order.status === 'EXPIRED') {
      try {
        await this.stock.take(tx, orderId, order.items, now);
      } catch (error) {
        if (error instanceof NotEnoughStockError) {
          return refund('ORDER_EXPIRED');
        }
        throw error;
      }
      await this.markOrderPaid(
        tx,
        record,
        razorpayPaymentId,
        order.status,
        now,
      );
      return { kind: 'PAID', orderId, late: true };
    }
    return refund(
      order.status === 'CANCELLED' ? 'ORDER_CANCELLED' : 'ALREADY_PAID',
    );
  }

  // The payment first: the database pays an order only once its payment is.
  private async markOrderPaid(
    tx: Prisma.TransactionClient,
    record: PaymentRecord,
    razorpayPaymentId: string,
    from: 'PENDING_PAYMENT' | 'EXPIRED',
    now: Date,
  ): Promise<void> {
    await this.payments.markPaid(tx, record.id, razorpayPaymentId, now);
    const { count } = await tx.order.updateMany({
      where: { id: record.orderId, status: from },
      data: { status: 'PAID' },
    });
    if (count !== 1) {
      throw new Error('The order changed while it was locked');
    }
  }

  // Razorpay unreachable or refusing: try again later. An order cancelled
  // or expired meanwhile is refused by the database: then it can't be paid.
  private async startFailed(
    userId: string,
    orderId: string,
    error: unknown,
  ): Promise<never> {
    if (error instanceof RazorpayError) {
      throw this.unavailable(error, 'Razorpay could not start a payment');
    }
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { status: true },
    });
    if (order && order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException(NOT_PAYABLE);
    }
    throw error;
  }

  // Razorpay can't be asked now: try again later. The log says why, with
  // Razorpay's status and code only.
  private unavailable(error: RazorpayError, what: string): RetryLaterException {
    this.logger.error({ status: error.status, code: error.code }, what);
    return new RetryLaterException(
      503,
      PAYMENTS_UNAVAILABLE,
      'PAYMENTS_UNAVAILABLE',
      RETRY_PAYMENTS_SECONDS,
    );
  }
}
