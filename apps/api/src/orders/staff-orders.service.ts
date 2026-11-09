import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { OrderStatus } from '../generated/prisma/enums';
import {
  PaymentsService,
  type StaffPayment,
} from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import type { StaffOrderListQuery } from './orders.schemas';
import {
  ORDER_NOT_FOUND,
  type OrderLine,
  type OrderView,
} from './orders.service';

// A line as staff see it: what to pick and pack, with its HSN code.
export interface StaffOrderLine extends OrderLine {
  hsnCode: string;
}

// An order in the staff list.
export interface StaffOrderSummary {
  id: string;
  reference: string;
  status: OrderStatus;
  totalRupees: number;
  deliveryName: string;
  deliveryCity: string;
  deliveryState: string;
  createdAt: Date;
}

// An order as staff see it, to pack and ship it (ADR 0028): its lines, its
// steps, and where it goes. The customer is named only by the delivery
// address, which is what fulfilment needs.
export interface StaffOrderView {
  id: string;
  reference: string;
  status: OrderStatus;
  createdAt: Date;
  holdExpiresAt: Date;
  packedAt: Date | null;
  shippedAt: Date | null;
  courierName: string | null;
  trackingNumber: string | null;
  deliveredAt: Date | null;
  items: StaffOrderLine[];
  itemsTotalRupees: number;
  itemsGstRupees: number;
  deliveryChargeRupees: number;
  totalRupees: number;
  delivery: OrderView['delivery'];
  // Super Users only: the payment with Razorpay's IDs, or null before
  // paying starts.
  payment?: StaffPayment | null;
}

const STAFF_SUMMARY_FIELDS = {
  id: true,
  reference: true,
  status: true,
  totalRupees: true,
  deliveryName: true,
  deliveryCity: true,
  deliveryState: true,
  createdAt: true,
} satisfies Prisma.OrderSelect;

const STAFF_ORDER_FIELDS = {
  id: true,
  reference: true,
  status: true,
  createdAt: true,
  holdExpiresAt: true,
  packedAt: true,
  shippedAt: true,
  courierName: true,
  trackingNumber: true,
  deliveredAt: true,
  itemsTotalRupees: true,
  itemsGstRupees: true,
  deliveryChargeRupees: true,
  totalRupees: true,
  deliveryName: true,
  deliveryPhone: true,
  deliveryLine1: true,
  deliveryLine2: true,
  deliveryCity: true,
  deliveryState: true,
  deliveryPincode: true,
  items: {
    orderBy: { position: 'asc' },
    select: {
      sku: true,
      productName: true,
      quantity: true,
      unit: true,
      packs: true,
      mrpRupees: true,
      priceRupees: true,
      lineTotalRupees: true,
      gstRate: true,
      gstRupees: true,
      hsnCode: true,
    },
  },
} satisfies Prisma.OrderSelect;

type StaffOrderRow = Prisma.OrderGetPayload<{
  select: typeof STAFF_ORDER_FIELDS;
}>;

// Orders for staff (ADR 0028). Admins and Super Users see every order, to
// pack and ship it. Only Super Users see its payment and refunds, with
// Razorpay's IDs: Admins never handle money.
@Injectable()
export class StaffOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  // Every order, one page at a time: those in one status, or the one with
  // a reference, the newest or the oldest first. Pages continue after the
  // ID of the last order shown.
  async list(
    query: StaffOrderListQuery,
  ): Promise<{ orders: StaffOrderSummary[]; nextAfter: string | null }> {
    const direction = query.sort === 'oldest' ? 'asc' : 'desc';
    const rows = await this.prisma.order.findMany({
      // A filter left out is undefined, and Prisma ignores it.
      where: { status: query.status, reference: query.reference },
      orderBy: [{ createdAt: direction }, { id: direction }],
      // One more than asked for, to know whether another page exists.
      take: query.limit + 1,
      // Start at the given order, but skip it: it was on the last page.
      ...(query.after ? { cursor: { id: query.after }, skip: 1 } : {}),
      select: STAFF_SUMMARY_FIELDS,
    });
    const orders = rows.slice(0, query.limit);
    return {
      orders,
      nextAfter:
        rows.length > query.limit ? orders[orders.length - 1].id : null,
    };
  }

  // One order, or 404. With its payment and refunds for Super Users only.
  async view(
    id: string,
    { withPayment }: { withPayment: boolean },
  ): Promise<StaffOrderView> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: STAFF_ORDER_FIELDS,
    });
    if (!order) {
      throw new NotFoundException(ORDER_NOT_FOUND);
    }
    const view = staffOrder(order);
    if (!withPayment) {
      return view;
    }
    return { ...view, payment: await this.payments.staffPaymentFor(id) };
  }
}

function staffOrder({
  deliveryName,
  deliveryPhone,
  deliveryLine1,
  deliveryLine2,
  deliveryCity,
  deliveryState,
  deliveryPincode,
  ...order
}: StaffOrderRow): StaffOrderView {
  return {
    ...order,
    delivery: {
      fullName: deliveryName,
      phone: deliveryPhone,
      line1: deliveryLine1,
      line2: deliveryLine2,
      city: deliveryCity,
      state: deliveryState,
      pincode: deliveryPincode,
    },
  };
}
