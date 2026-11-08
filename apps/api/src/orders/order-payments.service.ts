import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { RetryLaterException } from '../common/retry-later.exception';
import { PaymentsService } from '../payments/payments.service';
import { RazorpayError } from '../payments/razorpay.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { HOLD_OVER, NOT_PAYABLE, PAYMENTS_UNAVAILABLE } from './order-rules';
import { ORDER_NOT_FOUND } from './orders.service';

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

// Paying for orders (ADR 0027). An order asks the payments for its Razorpay
// order, and never reads their tables.
@Injectable()
export class OrderPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
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

  // Razorpay unreachable or refusing: try again later, and the log says
  // why, with Razorpay's status and code only. An order cancelled or
  // expired meanwhile is refused by the database: then it can't be paid.
  private async startFailed(
    userId: string,
    orderId: string,
    error: unknown,
  ): Promise<never> {
    if (error instanceof RazorpayError) {
      this.logger.error(
        { status: error.status, code: error.code },
        'Razorpay could not start a payment',
      );
      throw new RetryLaterException(
        503,
        PAYMENTS_UNAVAILABLE,
        'PAYMENTS_UNAVAILABLE',
        RETRY_PAYMENTS_SECONDS,
      );
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
}
