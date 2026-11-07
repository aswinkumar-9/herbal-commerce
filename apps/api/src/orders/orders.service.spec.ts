import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AddressesService } from '../addresses/addresses.service';
import type { CartService } from '../cart/cart.service';
import type { ShopPacksService } from '../catalog/shop-packs.service';
import { NotEnoughStockError } from '../inventory/stock.service';
import type { StockService } from '../inventory/stock.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  CART_EMPTY,
  notEnoughStock,
  notReady,
  TOO_MANY_OPEN,
  TOTAL_CHANGED,
} from './order-rules';
import { ORDER_NOT_FOUND, OrdersService } from './orders.service';

const USER = '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93';
const ADDRESS = '6f2b9d1e-4c7a-4e3b-9a85-1d2c3e4f5a6b';
const ORDER = '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d';
const KEY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const V60 = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const TEA = 'b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3';
// 7 November 2026, 11:30 in India.
const NOW = new Date('2026-11-07T06:00:00.000Z');

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
  mrpPaise: 50_000,
  pricePaise: 44_900,
  gstRate: 5,
  lineTotalPaise: 134_700,
  gstPaise: 6_414,
};
const teaLine = {
  sku: 'TULSI-100',
  productName: 'Tulsi Tea',
  quantity: 100,
  unit: 'G',
  packs: 1,
  mrpPaise: 25_000,
  pricePaise: 19_900,
  gstRate: 18,
  lineTotalPaise: 19_900,
  gstPaise: 3_036,
};
// Rs 1546 in all: delivery is free.
const totals = {
  itemsTotalPaise: 154_600,
  itemsGstPaise: 9_450,
  deliveryChargePaise: 0,
  totalPaise: 154_600,
};
const input = { addressId: ADDRESS, totalPaise: 154_600 };

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
    },
  };
  const prisma = {
    order: { findFirst: jest.fn().mockResolvedValue(orderRow) },
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
  };
  const orders = new OrdersService(
    prisma as unknown as PrismaService,
    addresses as unknown as AddressesService,
    cart as unknown as CartService,
    packs as unknown as ShopPacksService,
    stock as unknown as StockService,
  );
  return { orders, prisma, tx, addresses, cart, packs, stock };
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
      itemsTotalPaise: 19_900,
      deliveryChargePaise: 4_900,
      totalPaise: 24_800,
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
      orders.place(USER, KEY, { ...input, totalPaise: 149_700 }, NOW),
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
    const { orders, prisma } = setup();

    await expect(orders.view(USER, ORDER)).resolves.toEqual({
      id: ORDER,
      reference: '7KQ2M9XDPA',
      status: 'PENDING_PAYMENT',
      holdExpiresAt: new Date('2026-11-07T06:15:00.000Z'),
      createdAt: NOW,
      delivery: address,
      ...totals,
      items: [ashLine, teaLine],
    });
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

  it("answers 404 for an unknown order or someone else's", async () => {
    const { orders, prisma } = setup();
    prisma.order.findFirst.mockResolvedValue(null);

    await expect(orders.view(USER, ORDER)).rejects.toThrow(
      new NotFoundException(ORDER_NOT_FOUND),
    );
  });
});
