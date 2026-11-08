import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  RazorpayError,
  RazorpayGateway,
  type RazorpayOrder,
} from './razorpay.gateway';

// What a payment is for: one of our orders, its reference and its total.
export interface PayableOrder {
  orderId: string;
  reference: string;
  amountRupees: number;
}

// Payments and refunds (ADR 0027): the payments and refunds tables, and
// Razorpay behind them. The orders ask this service, never Razorpay or
// these tables.
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayGateway,
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
