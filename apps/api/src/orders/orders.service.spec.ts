import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AddressesService } from '../addresses/addresses.service';
import type { CartService } from '../cart/cart.service';
import type { ShopPacksService } from '../catalog/shop-packs.service';
import { NotEnoughStockError } from '../inventory/stock.service';
import type { StockService } from '../inventory/stock.service';
import type { PaymentsService } from '../payments/payments.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  CART_EMPTY,
  NOT_CANCELLABLE,
  notEnoughStock,
  notReady,
  TOO_MANY_OPEN,
  TOTAL_CHANGED,
} from './order-rules';
import {
  EXPIRE_PER_RUN,
  ORDER_NOT_FOUND,
  OrdersService,
} from './orders.service';

const USER = '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93';
const ADDRESS = '6f2b9d1e-4c7a-4e3b-9a85-1d2c3e4f5a6b';
const ORDER = '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d';
const KEY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const V60 = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const TEA = 'b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3';
// 7 November 2026, 11:30 in India.
const NOW = new Date('2026-11-07T06:00:00.000Z');
const REFUND = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f101';

const address = {
  fullName: 'Asha K',
  phone: '9845012345',
  line1: '12, 3rd Cross, Indiranagar',
  line2: 'Near the temple',
  city: 'Mysuru',
  state: 'Karnataka',
  pincode: '560038',
};
// Two pack sizes as the catalog describes them: sold now, unless changed.
const ash = (changes: object = {}) => ({
  variantId: V60,
  productVariantIds: [V60],
  sku: 'ASH-CAP-60',
  quantity: 60,
  unit: 'CAPSULES',
  mrpRupees: 500,
  priceRupees: 449,
  hsnCode: '300490',
  gstRate: 5,
  onSale: true,
  product: { name: 'Ashwagandha Capsules', slug: 'ash', imageUrl: null },
  ...changes,
});
const tea = (changes: object = {}) => ({
  variantId: TEA,
  productVariantIds: [TEA],
  sku: 'TULSI-100',
  quantity: 100,
  unit: 'G',
  mrpRupees: 250,
  priceRupees: 199,
  hsnCode: '0902',
  gstRate: 18,
  onSale: true,
  product: { name: 'Tulsi Tea', slug: 'tea', imageUrl: null },
  ...changes,
});
// 3 packs of Ashwagandha at Rs 449, and 1 of Tulsi Tea at Rs 199.
const cartLines = [
  { variantId: V60, packs: 3 },
  { variantId: TEA, packs: 1 },
];
const ashLine = {
  sku: 'ASH-CAP-60',
  productName: 'Ashwagandha Capsules',
  quantity: 60,
  unit: 'CAPSULES',
  packs: 3,
  mrpRupees: 500,
  priceRupees: 449,
  gstRate: 5,
  lineTotalRupees: 1_347,
  gstRupees: 64,
};
const teaLine = {
  sku: 'TULSI-100',
  productName: 'Tulsi Tea',
  quantity: 100,
  unit: 'G',
  packs: 1,
  mrpRupees: 250,
  priceRupees: 199,
  gstRate: 18,
  lineTotalRupees: 199,
  gstRupees: 30,
};
// Rs 1546 in all: delivery is free.
const totals = {
  itemsTotalRupees: 1_546,
  itemsGstRupees: 94,
  deliveryChargeRupees: 0,
  totalRupees: 1_546,
};
const input = { addressId: ADDRESS, totalRupees: 1_546 };

// The order as the query returns it.
const orderRow = {
  id: ORDER,
  reference: '7KQ2M9XDPA',
  status: 'PENDING_PAYMENT',
  holdExpiresAt: new Date('2026-11-07T06:15:00.000Z'),
  createdAt: NOW,
  deliveryName: 'Asha K',
  deliveryPhone: '9845012345',
  deliveryLine1: '12, 3rd Cross, Indiranagar',
  deliveryLine2: 'Near the temple',
  deliveryCity: 'Mysuru',
  deliveryState: 'Karnataka',
  deliveryPincode: '560038',
  ...totals,
  items: [ashLine, teaLine],
};

function setup() {
  const tx = {
    order: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: ORDER }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({ id: ORDER }),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ status: 'PENDING_PAYMENT' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue(orderRow),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const addresses = { deliveryAddress: jest.fn().mockResolvedValue(address) };
  const cart = {
    lines: jest.fn().mockResolvedValue(cartLines),
    lockedLines: jest.fn().mockResolvedValue(cartLines),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  const packs = { findByIds: jest.fn().mockResolvedValue([tea(), ash()]) };
  const stock = {
    inStock: jest.fn().mockResolvedValue(new Set([V60, TEA])),
    take: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const payments = {
    summaryFor: jest.fn().mockResolvedValue(null),
    refundInFull: jest.fn().mockResolvedValue(REFUND),
    requestRefund: jest.fn().mockResolvedValue(undefined),
  };
  const orders = new OrdersService(
    prisma as unknown as PrismaService,
    addresses as unknown as AddressesService,
    cart as unknown as CartService,
    packs as unknown as ShopPacksService,
    stock as unknown as StockService,
    payments as unknown as PaymentsService,
  );
  return { orders, prisma, tx, addresses, cart, packs, stock, payments };
}

describe('OrdersService.quote', () => {
  it("prices the cart at today's prices, line by line, with the GST inside, and changes nothing", async () => {
    const { orders, cart, packs, stock, prisma } = setup();

    await expect(orders.quote(USER)).resolves.toEqual({
      items: [ashLine, teaLine],
      ...totals,
    });
    expect(cart.lines).toHaveBeenCalledWith(USER);
    expect(packs.findByIds).toHaveBeenCalledWith([V60, TEA]);
    expect(stock.inStock).toHaveBeenCalledWith([V60, TEA]);
    expect(cart.lockedLines).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('adds Rs 49 for delivery below Rs 499', async () => {
    const { orders, cart } = setup();
    cart.lines.mockResolvedValue([{ variantId: TEA, packs: 1 }]);

    await expect(orders.quote(USER)).resolves.toMatchObject({
      itemsTotalRupees: 199,
      deliveryChargeRupees: 49,
      totalRupees: 248,
    });
  });

  it('refuses an empty cart', async () => {
    const { orders, cart } = setup();
    cart.lines.mockResolvedValue([]);

    await expect(orders.quote(USER)).rejects.toThrow(
      new ConflictException(CART_EMPTY),
    );
  });

  it("refuses a cart with packs that can't be bought now, naming each of them", async () => {
    const { orders, packs, stock } = setup();
    packs.findByIds.mockResolvedValue([ash({ onSale: false }), tea()]);
    stock.inStock.mockResolvedValue(new Set([V60]));

    await expect(orders.quote(USER)).rejects.toThrow(
      new ConflictException(notReady(['ASH-CAP-60', 'TULSI-100'])),
    );
  });

  it('refuses a pack without its GST details, and a pack deleted a moment ago', async () => {
    const { orders, packs } = setup();
    packs.findByIds.mockResolvedValueOnce([ash({ hsnCode: null }), tea()]);
    await expect(orders.quote(USER)).rejects.toThrow(
      new ConflictException(notReady(['ASH-CAP-60'])),
    );

    packs.findByIds.mockResolvedValueOnce([tea()]);
    await expect(orders.quote(USER)).rejects.toThrow(
      new ConflictException(TOTAL_CHANGED),
    );
  });
});

describe('OrdersService.place', () => {
  it('copies the address and the prices, holds the stock for 15 minutes, takes it, and empties the cart, all in one transaction', async () => {
    const { orders, tx, addresses, cart, stock } = setup();

    const placed = await orders.place(USER, KEY, input, NOW);

    expect(addresses.deliveryAddress).toHaveBeenCalledWith(USER, ADDRESS);
    expect(cart.lockedLines).toHaveBeenCalledWith(tx, USER);
    const [{ data, select }] = tx.order.create.mock.calls[0] as [
      { data: Record<string, unknown>; select: object },
    ];
    expect(data).toEqual({
      reference: expect.stringMatching(/^[A-HJ-NP-Z2-9]{10}$/),
      userId: USER,
      idempotencyKey: KEY,
      deliveryName: 'Asha K',
      deliveryPhone: '9845012345',
      deliveryLine1: '12, 3rd Cross, Indiranagar',
      deliveryLine2: 'Near the temple',
      deliveryCity: 'Mysuru',
      deliveryState: 'Karnataka',
      deliveryPincode: '560038',
      ...totals,
      holdExpiresAt: new Date('2026-11-07T06:15:00.000Z'),
      items: {
        create: [
          { ...ashLine, variantId: V60, hsnCode: '300490', position: 0 },
          { ...teaLine, variantId: TEA, hsnCode: '0902', position: 1 },
        ],
      },
    });
    expect(select).toEqual({ id: true });
    expect(stock.take).toHaveBeenCalledWith(
      tx,
      ORDER,
      [
        { ...ashLine, variantId: V60, hsnCode: '300490' },
        { ...teaLine, variantId: TEA, hsnCode: '0902' },
      ],
      NOW,
    );
    expect(cart.clear).toHaveBeenCalledWith(tx, USER);
    // The cart is locked first, and emptied last.
    const order = [
      cart.lockedLines,
      tx.order.findUnique,
      tx.order.count,
      tx.order.create,
      stock.take,
      cart.clear,
    ].map((step) => step.mock.invocationCallOrder[0]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The answer is the order as the customer sees it.
    expect(placed).toMatchObject({ id: ORDER, reference: '7KQ2M9XDPA' });
  });

  it('answers the order it placed the first time for the same Idempotency-Key, placing nothing', async () => {
    const { orders, tx, cart, stock } = setup();
    tx.order.findUnique.mockResolvedValue({ id: ORDER });

    await expect(orders.place(USER, KEY, input, NOW)).resolves.toMatchObject({
      id: ORDER,
    });
    expect(tx.order.findUnique).toHaveBeenCalledWith({
      where: { userId_idempotencyKey: { userId: USER, idempotencyKey: KEY } },
      select: { id: true },
    });
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(stock.take).not.toHaveBeenCalled();
    expect(cart.clear).not.toHaveBeenCalled();
  });

  it("answers 404 for an address that isn't the customer's, before anything else", async () => {
    const { orders, prisma, addresses } = setup();
    addresses.deliveryAddress.mockRejectedValue(
      new NotFoundException('Address not found'),
    );

    await expect(orders.place(USER, KEY, input, NOW)).rejects.toThrow(
      new NotFoundException('Address not found'),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a 4th order waiting for payment, but not a 3rd', async () => {
    const { orders, tx } = setup();
    tx.order.count.mockResolvedValueOnce(3);

    await expect(orders.place(USER, KEY, input, NOW)).rejects.toThrow(
      new ConflictException(TOO_MANY_OPEN),
    );
    expect(tx.order.count).toHaveBeenCalledWith({
      where: { userId: USER, status: 'PENDING_PAYMENT' },
    });
    expect(tx.order.create).not.toHaveBeenCalled();

    tx.order.count.mockResolvedValueOnce(2);
    await expect(orders.place(USER, KEY, input, NOW)).resolves.toBeDefined();
  });

  it('refuses when the total is not the one the customer saw', async () => {
    const { orders, tx } = setup();

    await expect(
      orders.place(USER, KEY, { ...input, totalRupees: 1_497 }, NOW),
    ).rejects.toThrow(new ConflictException(TOTAL_CHANGED));
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('refuses an empty cart', async () => {
    const { orders, cart, tx } = setup();
    cart.lockedLines.mockResolvedValue([]);

    await expect(orders.place(USER, KEY, input, NOW)).rejects.toThrow(
      new ConflictException(CART_EMPTY),
    );
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('refuses when the stock ran out meanwhile, naming the pack, and leaves the cart alone', async () => {
    const { orders, stock, cart } = setup();
    stock.take.mockRejectedValue(new NotEnoughStockError(TEA));

    await expect(orders.place(USER, KEY, input, NOW)).rejects.toThrow(
      new ConflictException(notEnoughStock('TULSI-100')),
    );
    expect(cart.clear).not.toHaveBeenCalled();
  });

  it('passes on any other error while taking the stock', async () => {
    const { orders, stock } = setup();
    const broken = new Error('connection lost');
    stock.take.mockRejectedValue(broken);

    await expect(orders.place(USER, KEY, input, NOW)).rejects.toBe(broken);
  });
});

describe('OrdersService.view', () => {
  it("shows the customer's own order, with its address and its lines in order", async () => {
    const { orders, prisma, payments } = setup();

    await expect(orders.view(USER, ORDER)).resolves.toEqual({
      id: ORDER,
      reference: '7KQ2M9XDPA',
      status: 'PENDING_PAYMENT',
      holdExpiresAt: new Date('2026-11-07T06:15:00.000Z'),
      createdAt: NOW,
      delivery: address,
      ...totals,
      items: [ashLine, teaLine],
      payment: null,
    });
    expect(payments.summaryFor).toHaveBeenCalledWith(ORDER);
    const [query] = prisma.order.findFirst.mock.calls[0] as [
      {
        where: object;
        select: { items: { orderBy: object; select: object } };
      },
    ];
    expect(query.where).toEqual({ id: ORDER, userId: USER });
    expect(query.select.items.orderBy).toEqual({ position: 'asc' });
    expect(Object.keys(query.select.items.select).sort()).toEqual(
      Object.keys(ashLine).sort(),
    );
  });

  it('shows its payment: when it was paid, and any money given back', async () => {
    const { orders, payments } = setup();
    const payment = {
      paidAt: NOW,
      refunds: [
        {
          amountRupees: 1_546,
          reason: 'ALREADY_PAID',
          status: 'PENDING',
          createdAt: NOW,
        },
      ],
    };
    payments.summaryFor.mockResolvedValueOnce(payment);

    await expect(orders.view(USER, ORDER)).resolves.toMatchObject({
      id: ORDER,
      payment,
    });
  });

  it("answers 404 for an unknown order or someone else's", async () => {
    const { orders, prisma, payments } = setup();
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(orders.view(USER, ORDER)).rejects.toThrow(
      new NotFoundException(ORDER_NOT_FOUND),
    );
    expect(payments.summaryFor).not.toHaveBeenCalled();
  });
});

describe('OrdersService.list', () => {
  const summary = (id: string) => ({
    id,
    reference: '7KQ2M9XDPA',
    status: 'PENDING_PAYMENT',
    totalRupees: 1_546,
    holdExpiresAt: NOW,
    createdAt: NOW,
  });

  it("lists the customer's own orders, the newest first, one page at a time", async () => {
    const { orders, prisma } = setup();
    prisma.order.findMany.mockResolvedValue([
      summary('o-3'),
      summary('o-2'),
      summary('o-1'),
    ]);

    await expect(
      orders.list(USER, { limit: 2, before: 'o-4' }),
    ).resolves.toEqual({
      orders: [summary('o-3'), summary('o-2')],
      nextBefore: 'o-2',
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: { userId: USER },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 3,
      cursor: { id: 'o-4' },
      skip: 1,
      select: {
        id: true,
        reference: true,
        status: true,
        totalRupees: true,
        holdExpiresAt: true,
        createdAt: true,
      },
    });

    prisma.order.findMany.mockResolvedValue([summary('o-1')]);
    await expect(orders.list(USER, { limit: 20 })).resolves.toEqual({
      orders: [summary('o-1')],
      nextBefore: null,
    });
    expect(prisma.order.findMany.mock.calls[1][0]).not.toHaveProperty('cursor');
  });
});

describe('OrdersService.cancel', () => {
  it('cancels an order waiting for payment, with the order locked, and gives its stock back, without a refund', async () => {
    const { orders, tx, stock, payments } = setup();

    await expect(orders.cancel(USER, ORDER, NOW)).resolves.toMatchObject({
      id: ORDER,
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: ORDER,
        userId: USER,
        status: { in: ['PENDING_PAYMENT', 'PAID', 'PACKED'] },
      },
      data: { updatedAt: NOW },
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: ORDER },
      data: { status: 'CANCELLED' },
    });
    expect(stock.release).toHaveBeenCalledWith(tx, ORDER);
    expect(payments.refundInFull).not.toHaveBeenCalled();
    expect(payments.requestRefund).not.toHaveBeenCalled();
  });

  it('cancels a paid or packed order: the refund saved before the status, the stock back, and Razorpay asked after the transaction', async () => {
    for (const status of ['PAID', 'PACKED']) {
      const { orders, prisma, tx, stock, payments } = setup();
      tx.order.findUniqueOrThrow.mockResolvedValueOnce({ status });

      await orders.cancel(USER, ORDER, NOW);

      expect(payments.refundInFull).toHaveBeenCalledWith(
        tx,
        ORDER,
        'CANCELLED_BY_CUSTOMER',
      );
      expect(
        payments.refundInFull.mock.invocationCallOrder[0] <
          tx.order.update.mock.invocationCallOrder[0],
      ).toBe(true);
      expect(stock.release).toHaveBeenCalledWith(tx, ORDER);
      expect(payments.requestRefund).toHaveBeenCalledWith(REFUND);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(
        stock.release.mock.invocationCallOrder[0] <
          payments.requestRefund.mock.invocationCallOrder[0],
      ).toBe(true);
    }
  });

  it('refuses an order that has shipped, or ended, and changes nothing', async () => {
    const { orders, tx, stock, payments } = setup();
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(orders.cancel(USER, ORDER, NOW)).rejects.toThrow(
      new ConflictException(NOT_CANCELLABLE),
    );
    expect(tx.order.findFirst).toHaveBeenCalledWith({
      where: { id: ORDER, userId: USER },
      select: { id: true },
    });
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(stock.release).not.toHaveBeenCalled();
    expect(payments.refundInFull).not.toHaveBeenCalled();
    expect(payments.requestRefund).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown order or someone else's", async () => {
    const { orders, tx, stock } = setup();
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    tx.order.findFirst.mockResolvedValue(null);

    await expect(orders.cancel(USER, ORDER, NOW)).rejects.toThrow(
      new NotFoundException(ORDER_NOT_FOUND),
    );
    expect(stock.release).not.toHaveBeenCalled();
  });
});

describe('OrdersService.cancelLocked', () => {
  it("cancels anyone's order for staff, for the reason given, and answers what it had", async () => {
    const { orders, tx, payments } = setup();
    tx.order.findUniqueOrThrow.mockResolvedValueOnce({ status: 'PACKED' });

    await expect(
      orders.cancelLocked(
        tx as never,
        { id: ORDER },
        'CANCELLED_BY_STAFF',
        NOW,
      ),
    ).resolves.toEqual({ from: 'PACKED', refundId: REFUND });
    expect(tx.order.updateMany.mock.calls[0][0].where).toStrictEqual({
      id: ORDER,
      status: { in: ['PENDING_PAYMENT', 'PAID', 'PACKED'] },
    });
    expect(tx.order.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: ORDER },
      select: { status: true },
    });
    expect(payments.refundInFull).toHaveBeenCalledWith(
      tx,
      ORDER,
      'CANCELLED_BY_STAFF',
    );
    expect(payments.requestRefund).not.toHaveBeenCalled();
  });

  it('answers no refund for an order that was never paid', async () => {
    const { orders, tx } = setup();

    await expect(
      orders.cancelLocked(
        tx as never,
        { id: ORDER },
        'CANCELLED_BY_STAFF',
        NOW,
      ),
    ).resolves.toEqual({ from: 'PENDING_PAYMENT', refundId: null });
  });
});

describe('OrdersService.expireUnpaid', () => {
  it('expires the orders whose hold has run out, each in its own transaction, and gives their stock back', async () => {
    const { orders, prisma, tx, stock } = setup();
    prisma.order.findMany.mockResolvedValue([{ id: 'o-1' }, { id: 'o-2' }]);

    await expect(orders.expireUnpaid(NOW)).resolves.toEqual({
      expired: 2,
      failed: 0,
    });
    expect(EXPIRE_PER_RUN).toBe(100);
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lte: NOW } },
      orderBy: { holdExpiresAt: 'asc' },
      take: 100,
      select: { id: true },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'o-2',
        status: 'PENDING_PAYMENT',
        holdExpiresAt: { lte: NOW },
      },
      data: { status: 'EXPIRED' },
    });
    expect(stock.release.mock.calls).toEqual([
      [tx, 'o-1'],
      [tx, 'o-2'],
    ]);
  });

  it('leaves alone an order paid or cancelled at the same moment', async () => {
    const { orders, prisma, tx, stock } = setup();
    prisma.order.findMany.mockResolvedValue([{ id: 'o-1' }]);
    tx.order.updateMany.mockResolvedValue({ count: 0 });

    await expect(orders.expireUnpaid(NOW)).resolves.toEqual({
      expired: 0,
      failed: 0,
    });
    expect(stock.release).not.toHaveBeenCalled();
  });

  it('counts an order that fails, and goes on with the others', async () => {
    const { orders, prisma, stock } = setup();
    prisma.order.findMany.mockResolvedValue([{ id: 'o-1' }, { id: 'o-2' }]);
    stock.release.mockRejectedValueOnce(new Error('connection lost'));

    await expect(orders.expireUnpaid(NOW)).resolves.toEqual({
      expired: 1,
      failed: 1,
    });
    expect(stock.release).toHaveBeenCalledTimes(2);
  });
});
