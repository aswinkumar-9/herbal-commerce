import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import type { NotificationKind, OrderStatus } from '../generated/prisma/enums';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PaymentsService,
  type StaffPayment,
} from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { NOT_ON_ITS_WAY, ORDER_STEPS, type OrderStep } from './order-rules';
import type {
  ShipmentCorrection,
  ShipmentInput,
  StaffOrderListQuery,
} from './orders.schemas';
import {
  ORDER_NOT_FOUND,
  OrdersService,
  type OrderLine,
  type OrderView,
} from './orders.service';

// A line as staff see it: what to pick and pack, with its HSN code.
export interface StaffOrderLine extends OrderLine {
  hsnCode: string;
}

// Who is looking: only a Super User sees an order's payment.
export interface StaffViewer {
  withPayment: boolean;
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

// The email each step sends the customer (ADR 0029).
const STEP_EMAILS = {
  PACKED: 'ORDER_PACKED',
  SHIPPED: 'ORDER_SHIPPED',
  DELIVERED: 'ORDER_DELIVERED',
} as const satisfies Record<OrderStep, NotificationKind>;

// Orders for staff (ADR 0028). Admins and Super Users see every order, and
// take it through its steps: packed, shipped, delivered. Each step is
// audited in the same transaction. Only Super Users see an order's payment
// and refunds, with Razorpay's IDs, and cancel an order that has been paid:
// Admins never handle money.
@Injectable()
export class StaffOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @InjectPinoLogger(StaffOrdersService.name)
    private readonly logger: PinoLogger,
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
    { withPayment }: StaffViewer,
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

  // Marks a paid order packed.
  markPacked(
    id: string,
    context: AuditContext,
    viewer: StaffViewer,
    now = new Date(),
  ): Promise<StaffOrderView> {
    return this.takeStep(id, 'PACKED', { packedAt: now }, {}, context, viewer);
  }

  // Marks a packed order shipped: handed to the courier, with its tracking
  // number.
  markShipped(
    id: string,
    shipment: ShipmentInput,
    context: AuditContext,
    viewer: StaffViewer,
    now = new Date(),
  ): Promise<StaffOrderView> {
    return this.takeStep(
      id,
      'SHIPPED',
      { shippedAt: now, ...shipment },
      shipment,
      context,
      viewer,
    );
  }

  // Marks a shipped order delivered.
  markDelivered(
    id: string,
    context: AuditContext,
    viewer: StaffViewer,
    now = new Date(),
  ): Promise<StaffOrderView> {
    return this.takeStep(
      id,
      'DELIVERED',
      { deliveredAt: now },
      {},
      context,
      viewer,
    );
  }

  // Cancels an order that hasn't shipped, for a Super User: its stock comes
  // back, and a paid order's payment goes back in full, asked of Razorpay
  // once the cancel and its audit entry are saved.
  async cancel(
    id: string,
    context: AuditContext,
    viewer: StaffViewer,
    now = new Date(),
  ): Promise<StaffOrderView> {
    const { from, refundId } = await this.prisma.$transaction(async (tx) => {
      const cancelled = await this.orders.cancelLocked(
        tx,
        { id },
        'CANCELLED_BY_STAFF',
        now,
      );
      await this.audit.record(tx, {
        ...context,
        action: 'order.cancelled',
        targetType: 'order',
        targetId: id,
        before: { status: cancelled.from },
        after: { status: 'CANCELLED', refundId: cancelled.refundId },
      });
      return cancelled;
    });
    if (refundId) {
      await this.payments.requestRefund(refundId);
    }
    this.logger.info(
      { orderId: id, actorId: context.actorId, from },
      'Order cancelled by staff',
    );
    return this.view(id, viewer);
  }

  // Corrects the courier or the tracking number of an order on its way,
  // with the order locked, so two corrections take turns. One that changes
  // nothing writes no audit entry.
  async correctShipment(
    id: string,
    correction: ShipmentCorrection,
    context: AuditContext,
    viewer: StaffViewer,
    now = new Date(),
  ): Promise<StaffOrderView> {
    const changed = await this.prisma.$transaction(async (tx) => {
      // The lock: the order's row stays locked until the transaction ends.
      const { count } = await tx.order.updateMany({
        where: { id, status: 'SHIPPED' },
        data: { updatedAt: now },
      });
      if (count === 0) {
        const order = await tx.order.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!order) {
          throw new NotFoundException(ORDER_NOT_FOUND);
        }
        throw new ConflictException(NOT_ON_ITS_WAY);
      }
      const current = await tx.order.findUniqueOrThrow({
        where: { id },
        select: { courierName: true, trackingNumber: true },
      });
      const fields = (['courierName', 'trackingNumber'] as const).filter(
        (field) =>
          correction[field] !== undefined &&
          correction[field] !== current[field],
      );
      if (fields.length === 0) {
        return false;
      }
      const before = Object.fromEntries(
        fields.map((field) => [field, current[field]]),
      );
      const after = Object.fromEntries(
        fields.map((field) => [field, correction[field]]),
      );
      await tx.order.update({ where: { id }, data: after });
      await this.audit.record(tx, {
        ...context,
        action: 'order.shipment_corrected',
        targetType: 'order',
        targetId: id,
        before,
        after,
      });
      await this.notifications.queue(tx, {
        kind: 'SHIPMENT_CORRECTED',
        orderId: id,
      });
      return true;
    });
    if (changed) {
      this.logger.info(
        { orderId: id, actorId: context.actorId },
        'Order shipment corrected',
      );
    }
    return this.view(id, viewer);
  }

  // Takes one step, guarded by the order's status: only an order in the
  // step's status moves on, so a double click, or two staff at once, move
  // it once. The step, its audit entry and the email that tells the
  // customer (ADR 0029) are one transaction.
  private async takeStep(
    id: string,
    to: OrderStep,
    data: Prisma.OrderUpdateManyMutationInput,
    details: Record<string, string>,
    context: AuditContext,
    viewer: StaffViewer,
  ): Promise<StaffOrderView> {
    const step = ORDER_STEPS[to];
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id, status: step.from },
        data: { status: to, ...data },
      });
      if (count === 0) {
        const order = await tx.order.findUnique({
          where: { id },
          select: { status: true },
        });
        if (!order) {
          throw new NotFoundException(ORDER_NOT_FOUND);
        }
        throw new ConflictException(
          order.status === to ? step.done : step.notReady,
        );
      }
      await this.notifications.queue(tx, {
        kind: STEP_EMAILS[to],
        orderId: id,
      });
      await this.audit.record(tx, {
        ...context,
        action: `order.${to.toLowerCase()}`,
        targetType: 'order',
        targetId: id,
        before: { status: step.from },
        after: { status: to, ...details },
      });
    });
    this.logger.info(
      { orderId: id, actorId: context.actorId, status: to },
      'Order moved to its next step',
    );
    return this.view(id, viewer);
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
