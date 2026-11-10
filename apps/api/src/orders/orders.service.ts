import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AddressesService } from '../addresses/addresses.service';
import { CartService } from '../cart/cart.service';
import { ShopPacksService } from '../catalog/shop-packs.service';
import type { Prisma } from '../generated/prisma/client';
import type {
  OrderStatus,
  PackUnit,
  RefundReason,
} from '../generated/prisma/enums';
import { NotEnoughStockError, StockService } from '../inventory/stock.service';
import {
  PaymentsService,
  type PaymentSummary,
} from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CANCELLABLE,
  CART_EMPTY,
  holdExpiresAt,
  lineAmounts,
  MAX_OPEN_ORDERS,
  newOrderReference,
  NOT_CANCELLABLE,
  notEnoughStock,
  notReady,
  orderTotals,
  TOO_MANY_OPEN,
  TOTAL_CHANGED,
} from './order-rules';
import type { OrderListQuery, PlaceOrderInput } from './orders.schemas';

export const ORDER_NOT_FOUND = 'Order not found';
// The expiry job takes at most this many orders a run; the rest wait for
// the next run, a minute later.
export const EXPIRE_PER_RUN = 100;

// A line of a checkout or an order as the customer sees it: the pack size
// by its SKU, never by an ID. Money in whole rupees.
export interface OrderLine {
  sku: string;
  productName: string;
  quantity: number;
  unit: PackUnit;
  packs: number;
  mrpRupees: number;
  priceRupees: number;
  lineTotalRupees: number;
  gstRate: number;
  gstRupees: number;
}

// What the cart would cost as an order now.
export interface Quote {
  items: OrderLine[];
  itemsTotalRupees: number;
  itemsGstRupees: number;
  deliveryChargeRupees: number;
  totalRupees: number;
}

// An order as its customer sees it.
export interface OrderView extends Quote {
  id: string;
  reference: string;
  status: OrderStatus;
  holdExpiresAt: Date;
  createdAt: Date;
  // How far it has come (ADR 0028): when it was packed, shipped and
  // delivered, and the courier with its tracking number. Each is null until
  // then.
  packedAt: Date | null;
  shippedAt: Date | null;
  courierName: string | null;
  trackingNumber: string | null;
  deliveredAt: Date | null;
  delivery: {
    fullName: string;
    phone: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    pincode: string;
  };
  // When it was paid, and any money given back; null before paying starts
  // (ADR 0027).
  payment: PaymentSummary | null;
}

// An order in the customer's list of orders.
export interface OrderSummary {
  id: string;
  reference: string;
  status: OrderStatus;
  totalRupees: number;
  holdExpiresAt: Date;
  createdAt: Date;
}

// A priced line with what only the order keeps: the pack size's ID, and
// its HSN code for the invoice.
interface PricedLine extends OrderLine {
  variantId: string;
  hsnCode: string;
}

const LINE_FIELDS = {
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
} satisfies Prisma.OrderItemSelect;

const ORDER_FIELDS = {
  id: true,
  reference: true,
  status: true,
  holdExpiresAt: true,
  createdAt: true,
  packedAt: true,
  shippedAt: true,
  courierName: true,
  trackingNumber: true,
  deliveredAt: true,
  deliveryName: true,
  deliveryPhone: true,
  deliveryLine1: true,
  deliveryLine2: true,
  deliveryCity: true,
  deliveryState: true,
  deliveryPincode: true,
  itemsTotalRupees: true,
  itemsGstRupees: true,
  deliveryChargeRupees: true,
  totalRupees: true,
  items: { orderBy: { position: 'asc' }, select: LINE_FIELDS },
} satisfies Prisma.OrderSelect;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_FIELDS }>;

const SUMMARY_FIELDS = {
  id: true,
  reference: true,
  status: true,
  totalRupees: true,
  holdExpiresAt: true,
  createdAt: true,
} satisfies Prisma.OrderSelect;

// A customer's orders, the newest first.
const NEWEST_FIRST = [
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.OrderOrderByWithRelationInput[];

// Customers' orders (ADR 0026). An order is placed from the whole cart, at
// today's prices, and keeps a copy of everything the customer agreed to.
// It takes its stock at once and holds it until paid, for 15 minutes. It
// asks the other modules for the address, the cart, the packs, the stock
// and the payment, never their tables.
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly addresses: AddressesService,
    private readonly cart: CartService,
    private readonly packs: ShopPacksService,
    private readonly stock: StockService,
    private readonly payments: PaymentsService,
  ) {}

  // What the customer's cart would cost as an order now: today's prices,
  // the GST inside them and the delivery charge. The same rules as placing
  // the order, so a cart that cannot be ordered answers 409 here too.
  async quote(userId: string): Promise<Quote> {
    const { lines, totals } = await this.price(await this.cart.lines(userId));
    return { items: lines.map(customerLine), ...totals };
  }

  // Places an order from the whole cart, to one of the customer's
  // addresses, and answers the order. In one transaction, with the cart
  // locked: the lines are priced, the total must be the one the customer
  // saw, the stock is taken from the batches that expire first, and the
  // cart is emptied. The same Idempotency-Key again answers the order it
  // placed the first time, and places nothing.
  async place(
    userId: string,
    idempotencyKey: string,
    input: PlaceOrderInput,
    now = new Date(),
  ): Promise<OrderView> {
    const address = await this.addresses.deliveryAddress(
      userId,
      input.addressId,
    );
    const orderId = await this.prisma.$transaction(async (tx) => {
      const cartLines = await this.cart.lockedLines(tx, userId);
      const placed = await tx.order.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        select: { id: true },
      });
      if (placed) {
        return placed.id;
      }
      const open = await tx.order.count({
        where: { userId, status: 'PENDING_PAYMENT' },
      });
      if (open >= MAX_OPEN_ORDERS) {
        throw new ConflictException(TOO_MANY_OPEN);
      }
      const { lines, totals } = await this.price(cartLines);
      if (totals.totalRupees !== input.totalRupees) {
        throw new ConflictException(TOTAL_CHANGED);
      }
      const order = await tx.order.create({
        data: {
          reference: newOrderReference(),
          userId,
          idempotencyKey,
          deliveryName: address.fullName,
          deliveryPhone: address.phone,
          deliveryLine1: address.line1,
          deliveryLine2: address.line2,
          deliveryCity: address.city,
          deliveryState: address.state,
          deliveryPincode: address.pincode,
          ...totals,
          holdExpiresAt: holdExpiresAt(now),
          items: {
            create: lines.map((line, position) => ({ ...line, position })),
          },
        },
        select: { id: true },
      });
      try {
        await this.stock.take(tx, order.id, lines, now);
      } catch (error) {
        if (error instanceof NotEnoughStockError) {
          const line = lines.find((l) => l.variantId === error.variantId);
          throw new ConflictException(notEnoughStock(line?.sku ?? ''));
        }
        throw error;
      }
      await this.cart.clear(tx, userId);
      return order.id;
    });
    return this.view(userId, orderId);
  }

  // The customer's own order, or 404, like someone else's.
  async view(userId: string, id: string): Promise<OrderView> {
    const order = await this.prisma.order.findFirst({
      where: { id, userId },
      select: ORDER_FIELDS,
    });
    if (!order) {
      throw new NotFoundException(ORDER_NOT_FOUND);
    }
    return customerOrder(order, await this.payments.summaryFor(order.id));
  }

  // The customer's orders, the newest first, one page at a time. Pages
  // continue after the ID of the last order shown.
  async list(
    userId: string,
    query: OrderListQuery,
  ): Promise<{ orders: OrderSummary[]; nextBefore: string | null }> {
    const rows = await this.prisma.order.findMany({
      where: { userId },
      orderBy: NEWEST_FIRST,
      take: query.limit + 1,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
      select: SUMMARY_FIELDS,
    });
    const orders = rows.slice(0, query.limit);
    return {
      orders,
      nextBefore:
        rows.length > query.limit ? orders[orders.length - 1].id : null,
    };
  }

  // Cancels the customer's own order until it ships, and gives its stock
  // back. A paid order's payment goes back in full: saved in the same
  // transaction, and asked of Razorpay after it (ADR 0028). Any other order
  // answers 409; someone else's, 404.
  async cancel(
    userId: string,
    id: string,
    now = new Date(),
  ): Promise<OrderView> {
    const { refundId } = await this.prisma.$transaction((tx) =>
      this.cancelLocked(tx, { id, userId }, 'CANCELLED_BY_CUSTOMER', now),
    );
    if (refundId) {
      await this.payments.requestRefund(refundId);
    }
    return this.view(userId, id);
  }

  // Cancels an order that hasn't shipped, inside the caller's transaction,
  // with the order locked: so a payment, an expiry or a staff step at the
  // same moment waits, and then finds it cancelled. Its stock comes back,
  // and once paid, its payment is saved as going back in full, for the
  // reason given. The caller asks Razorpay for the refund once the
  // transaction is saved. Answers the status the order had, and the
  // refund's ID, if any.
  async cancelLocked(
    tx: Prisma.TransactionClient,
    where: { id: string; userId?: string },
    reason: Extract<
      RefundReason,
      'CANCELLED_BY_CUSTOMER' | 'CANCELLED_BY_STAFF'
    >,
    now: Date,
  ): Promise<{ from: OrderStatus; refundId: string | null }> {
    // The lock: the order's row stays locked until the transaction ends.
    const { count } = await tx.order.updateMany({
      where: { ...where, status: { in: [...CANCELLABLE] } },
      data: { updatedAt: now },
    });
    if (count === 0) {
      const order = await tx.order.findFirst({ where, select: { id: true } });
      if (!order) {
        throw new NotFoundException(ORDER_NOT_FOUND);
      }
      throw new ConflictException(NOT_CANCELLABLE);
    }
    const { status: from } = await tx.order.findUniqueOrThrow({
      where: { id: where.id },
      select: { status: true },
    });
    // The refund first: the database cancels a paid order only with its
    // payment going back.
    const refundId =
      from === 'PENDING_PAYMENT'
        ? null
        : await this.payments.refundInFull(tx, where.id, reason);
    await tx.order.update({
      where: { id: where.id },
      data: { status: 'CANCELLED' },
    });
    await this.stock.release(tx, where.id);
    return { from, refundId };
  }

  // Expires the orders still waiting for payment after their hold, and
  // gives their stock back: each in its own transaction, so one that fails
  // keeps no other waiting. An order paid or cancelled at that same moment
  // is left alone. Answers how many expired, and how many failed.
  async expireUnpaid(
    now = new Date(),
  ): Promise<{ expired: number; failed: number }> {
    const due = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lte: now } },
      orderBy: { holdExpiresAt: 'asc' },
      take: EXPIRE_PER_RUN,
      select: { id: true },
    });
    let expired = 0;
    let failed = 0;
    for (const { id } of due) {
      try {
        const done = await this.prisma.$transaction(async (tx) => {
          const { count } = await tx.order.updateMany({
            where: {
              id,
              status: 'PENDING_PAYMENT',
              holdExpiresAt: { lte: now },
            },
            data: { status: 'EXPIRED' },
          });
          if (count === 0) {
            return false;
          }
          await this.stock.release(tx, id);
          return true;
        });
        if (done) {
          expired += 1;
        }
      } catch {
        failed += 1;
      }
    }
    return { expired, failed };
  }

  // The cart's lines at today's prices, with what they come to. An empty
  // cart, or a pack that cannot be bought now, answers 409, naming every
  // such pack.
  private async price(
    cartLines: { variantId: string; packs: number }[],
  ): Promise<{ lines: PricedLine[]; totals: ReturnType<typeof orderTotals> }> {
    if (cartLines.length === 0) {
      throw new ConflictException(CART_EMPTY);
    }
    const variantIds = cartLines.map((line) => line.variantId);
    const [packs, inStock] = await Promise.all([
      this.packs.findByIds(variantIds),
      this.stock.inStock(variantIds),
    ]);
    const byId = new Map(packs.map((pack) => [pack.variantId, pack]));
    const unavailable: string[] = [];
    const lines: PricedLine[] = [];
    for (const { variantId, packs: count } of cartLines) {
      const pack = byId.get(variantId);
      // Deleted a moment ago: the cart is not what the customer saw.
      if (!pack) {
        throw new ConflictException(TOTAL_CHANGED);
      }
      if (
        !pack.onSale ||
        !inStock.has(variantId) ||
        pack.hsnCode === null ||
        pack.gstRate === null
      ) {
        unavailable.push(pack.sku);
        continue;
      }
      lines.push({
        variantId,
        hsnCode: pack.hsnCode,
        sku: pack.sku,
        productName: pack.product.name,
        quantity: pack.quantity,
        unit: pack.unit,
        packs: count,
        mrpRupees: pack.mrpRupees,
        priceRupees: pack.priceRupees,
        gstRate: pack.gstRate,
        ...lineAmounts({
          priceRupees: pack.priceRupees,
          packs: count,
          gstRate: pack.gstRate,
        }),
      });
    }
    if (unavailable.length > 0) {
      throw new ConflictException(notReady(unavailable));
    }
    return { lines, totals: orderTotals(lines) };
  }
}

// A priced line without what the customer never sees.
function customerLine({
  variantId: _variantId,
  hsnCode: _hsnCode,
  ...line
}: PricedLine): OrderLine {
  return line;
}

function customerOrder(
  {
    deliveryName,
    deliveryPhone,
    deliveryLine1,
    deliveryLine2,
    deliveryCity,
    deliveryState,
    deliveryPincode,
    ...order
  }: OrderRow,
  payment: PaymentSummary | null,
): OrderView {
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
    payment,
  };
}
