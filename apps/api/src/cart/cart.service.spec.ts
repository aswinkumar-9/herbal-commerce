import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ShopPacksService } from '../catalog/shop-packs.service';
import type { Prisma } from '../generated/prisma/client';
import type { StockService } from '../inventory/stock.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CART_FULL, OUT_OF_STOCK, tooManyOfProduct } from './cart-rules';
import { CartService, PACK_NOT_FOUND } from './cart.service';

const USER = '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93';
const CART = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
// Two pack sizes of one product, and a pack size of another.
const V60 = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const V120 = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
const TEA = 'b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3';
const ashwagandha = {
  name: 'Ashwagandha Capsules',
  slug: 'ashwagandha-capsules',
  imageUrl: 'http://media/products/a-small.webp',
};

// A pack size as the catalog describes it: sold now, unless changed.
function pack(changes: object = {}) {
  return {
    variantId: V60,
    productVariantIds: [V60, V120],
    sku: 'ASH-CAP-60',
    quantity: 60,
    unit: 'CAPSULES',
    mrpRupees: 500,
    priceRupees: 449,
    onSale: true,
    product: ashwagandha,
    ...changes,
  };
}
const pack120 = pack({
  variantId: V120,
  sku: 'ASH-CAP-120',
  quantity: 120,
  mrpRupees: 900,
  priceRupees: 799,
});
const tea = pack({
  variantId: TEA,
  productVariantIds: [TEA],
  sku: 'TULSI-TEA-100',
  quantity: 100,
  unit: 'G',
  mrpRupees: 250,
  priceRupees: 199,
  product: { name: 'Tulsi Tea', slug: 'tulsi-tea', imageUrl: null },
});

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: CART }]),
    cartItem: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    cart: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    cartItem: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((work: unknown) =>
      typeof work === 'function'
        ? (work as (client: typeof tx) => unknown)(tx)
        : Promise.all(work as unknown[]),
    ),
  };
  const packs = {
    findBySku: jest.fn().mockResolvedValue(pack()),
    findByIds: jest.fn().mockResolvedValue([]),
  };
  const stock = {
    inStock: jest.fn().mockResolvedValue(new Set([V60, V120, TEA])),
  };
  const cart = new CartService(
    prisma as unknown as PrismaService,
    packs as unknown as ShopPacksService,
    stock as unknown as StockService,
  );
  return { cart, prisma, tx, packs, stock };
}

describe('CartService.view', () => {
  it('is empty for a customer without a cart', async () => {
    const { cart, prisma } = setup();

    await expect(cart.view(USER)).resolves.toEqual({
      items: [],
      packs: 0,
      subtotalRupees: 0,
      mrpTotalRupees: 0,
    });
    expect(prisma.cartItem.findMany.mock.calls[0][0]).toMatchObject({
      where: { cart: { userId: USER } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it("shows each line with today's prices, the first added first, and counts only the lines that can be bought", async () => {
    const { cart, prisma, packs, stock } = setup();
    prisma.cartItem.findMany.mockResolvedValue([
      { variantId: V60, packs: 2 },
      { variantId: TEA, packs: 1 },
      { variantId: V120, packs: 1 },
    ]);
    packs.findByIds.mockResolvedValue([
      pack120,
      { ...tea, onSale: false },
      pack(),
    ]);
    stock.inStock.mockResolvedValue(new Set([V60, TEA]));

    await expect(cart.view(USER)).resolves.toEqual({
      items: [
        {
          product: ashwagandha,
          sku: 'ASH-CAP-60',
          quantity: 60,
          unit: 'CAPSULES',
          mrpRupees: 500,
          priceRupees: 449,
          packs: 2,
          lineTotalRupees: 898,
          status: 'AVAILABLE',
        },
        {
          product: { name: 'Tulsi Tea', slug: 'tulsi-tea', imageUrl: null },
          sku: 'TULSI-TEA-100',
          quantity: 100,
          unit: 'G',
          mrpRupees: 250,
          priceRupees: 199,
          packs: 1,
          lineTotalRupees: 199,
          status: 'OFF_SALE',
        },
        {
          product: ashwagandha,
          sku: 'ASH-CAP-120',
          quantity: 120,
          unit: 'CAPSULES',
          mrpRupees: 900,
          priceRupees: 799,
          packs: 1,
          lineTotalRupees: 799,
          status: 'OUT_OF_STOCK',
        },
      ],
      packs: 2,
      subtotalRupees: 898,
      mrpTotalRupees: 1000,
    });
    expect(packs.findByIds).toHaveBeenCalledWith([V60, TEA, V120]);
    expect(stock.inStock).toHaveBeenCalledWith([V60, TEA, V120]);
  });

  it('leaves out a line whose pack size was deleted a moment ago', async () => {
    const { cart, prisma, packs } = setup();
    prisma.cartItem.findMany.mockResolvedValue([
      { variantId: V60, packs: 1 },
      { variantId: V120, packs: 1 },
    ]);
    packs.findByIds.mockResolvedValue([pack()]);

    const view = await cart.view(USER);
    expect(view.items.map((line) => line.sku)).toEqual(['ASH-CAP-60']);
    expect(view.subtotalRupees).toBe(449);
  });
});

describe('CartService.setPacks', () => {
  it('adds a pack size sold now and in stock, in the locked cart, and answers the cart', async () => {
    const { cart, prisma, tx, packs, stock } = setup();
    prisma.cartItem.findMany.mockResolvedValue([{ variantId: V60, packs: 2 }]);
    packs.findByIds.mockResolvedValue([pack()]);

    const view = await cart.setPacks(USER, 'ASH-CAP-60', 2);

    expect(packs.findBySku).toHaveBeenCalledWith('ASH-CAP-60');
    expect(stock.inStock).toHaveBeenCalledWith([V60]);
    // The cart is made or found, marked as changed and locked, by the
    // customer's ID sent as a parameter.
    const [sql, ...values] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(sql.join('?')).toContain(
      'ON CONFLICT ("userId") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP',
    );
    expect(values).toEqual([USER]);
    expect(tx.cartItem.findMany.mock.calls[0][0].where).toEqual({
      cartId: CART,
    });
    expect(tx.cartItem.upsert).toHaveBeenCalledWith({
      where: { cartId_variantId: { cartId: CART, variantId: V60 } },
      create: { cartId: CART, variantId: V60, packs: 2 },
      update: { packs: 2 },
    });
    expect(view.items[0]).toMatchObject({ sku: 'ASH-CAP-60', packs: 2 });
  });

  it('answers 404 for an unknown SKU, or a pack size not sold now, before touching the cart', async () => {
    const { cart, prisma, packs } = setup();
    packs.findBySku
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pack({ onSale: false }));

    for (let i = 0; i < 2; i++) {
      await expect(cart.setPacks(USER, 'ASH-CAP-60', 1)).rejects.toThrow(
        new NotFoundException(PACK_NOT_FOUND),
      );
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("counts the packs of the product's other sizes, and not other products", async () => {
    const { cart, tx } = setup();
    tx.cartItem.findMany.mockResolvedValue([
      { variantId: V120, packs: 3 },
      { variantId: TEA, packs: 4 },
    ]);

    await expect(cart.setPacks(USER, 'ASH-CAP-60', 1)).resolves.toBeDefined();
    await expect(cart.setPacks(USER, 'ASH-CAP-60', 2)).rejects.toThrow(
      new ConflictException(tooManyOfProduct(3)),
    );
    expect(tx.cartItem.upsert).toHaveBeenCalledTimes(1);
  });

  it('counts the packs the line already holds as its own, not as other sizes', async () => {
    const { cart, tx } = setup();
    tx.cartItem.findMany.mockResolvedValue([
      { variantId: V60, packs: 3 },
      { variantId: V120, packs: 1 },
    ]);

    await expect(cart.setPacks(USER, 'ASH-CAP-60', 3)).resolves.toBeDefined();
    await expect(cart.setPacks(USER, 'ASH-CAP-60', 4)).rejects.toThrow(
      new ConflictException(tooManyOfProduct(1)),
    );
  });

  it('refuses adding a pack size out of stock, but lets its packs go down', async () => {
    const { cart, tx, stock } = setup();
    stock.inStock.mockResolvedValue(new Set());

    await expect(cart.setPacks(USER, 'ASH-CAP-60', 1)).rejects.toThrow(
      new ConflictException(OUT_OF_STOCK),
    );
    expect(tx.cartItem.upsert).not.toHaveBeenCalled();

    tx.cartItem.findMany.mockResolvedValue([{ variantId: V60, packs: 3 }]);
    await expect(cart.setPacks(USER, 'ASH-CAP-60', 1)).resolves.toBeDefined();
    expect(tx.cartItem.upsert.mock.calls[0][0].update).toEqual({ packs: 1 });
  });

  it('refuses a 51st pack size', async () => {
    const { cart, tx } = setup();
    tx.cartItem.findMany.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({
        variantId: `other-${i}`,
        packs: 1,
      })),
    );

    await expect(cart.setPacks(USER, 'ASH-CAP-60', 1)).rejects.toThrow(
      new ConflictException(CART_FULL),
    );
  });
});

describe('CartService.remove and empty', () => {
  it("takes the pack size out of the customer's cart, and marks the cart as changed", async () => {
    const { cart, prisma, packs } = setup();
    packs.findBySku.mockResolvedValue(pack({ onSale: false }));

    await expect(cart.remove(USER, 'ASH-CAP-60')).resolves.toBeUndefined();
    expect(prisma.cart.updateMany).toHaveBeenCalledWith({
      where: { userId: USER },
      data: { updatedAt: expect.any(Date) },
    });
    expect(prisma.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { cart: { userId: USER }, variantId: V60 },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an unknown SKU', async () => {
    const { cart, prisma, packs } = setup();
    packs.findBySku.mockResolvedValue(null);

    await expect(cart.remove(USER, 'NOPE-1')).resolves.toBeUndefined();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("empties the customer's cart by deleting it", async () => {
    const { cart, prisma } = setup();

    await expect(cart.empty(USER)).resolves.toBeUndefined();
    expect(prisma.cart.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER },
    });
  });
});

describe('CartService.lockedLines and clear, for an order', () => {
  function orderTx() {
    return {
      cart: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      cartItem: {
        findMany: jest.fn().mockResolvedValue([{ variantId: V60, packs: 2 }]),
      },
    };
  }

  it("locks the customer's cart by marking it changed, then reads its lines, the first added first", async () => {
    const { cart } = setup();
    const tx = orderTx();

    await expect(
      cart.lockedLines(tx as unknown as Prisma.TransactionClient, USER),
    ).resolves.toEqual([{ variantId: V60, packs: 2 }]);
    expect(tx.cart.updateMany).toHaveBeenCalledWith({
      where: { userId: USER },
      data: { updatedAt: expect.any(Date) },
    });
    expect(tx.cartItem.findMany).toHaveBeenCalledWith({
      where: { cart: { userId: USER } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { variantId: true, packs: true },
    });
    expect(tx.cart.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.cartItem.findMany.mock.invocationCallOrder[0],
    );
  });

  it('reads the lines for a look at checkout without marking the cart', async () => {
    const { cart, prisma } = setup();
    prisma.cartItem.findMany.mockResolvedValue([{ variantId: V60, packs: 1 }]);

    await expect(cart.lines(USER)).resolves.toEqual([
      { variantId: V60, packs: 1 },
    ]);
    expect(prisma.cartItem.findMany).toHaveBeenCalledWith({
      where: { cart: { userId: USER } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { variantId: true, packs: true },
    });
    expect(prisma.cart.updateMany).not.toHaveBeenCalled();
  });

  it("empties the customer's cart inside the order's transaction", async () => {
    const { cart, prisma } = setup();
    const tx = orderTx();

    await expect(
      cart.clear(tx as unknown as Prisma.TransactionClient, USER),
    ).resolves.toBeUndefined();
    expect(tx.cart.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER },
    });
    expect(prisma.cart.deleteMany).not.toHaveBeenCalled();
  });
});
