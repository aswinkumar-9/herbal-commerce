import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ShopPacksService } from '../catalog/shop-packs.service';
import type { Prisma } from '../generated/prisma/client';
import type { PackUnit } from '../generated/prisma/enums';
import { StockService } from '../inventory/stock.service';
import { PrismaService } from '../prisma/prisma.service';
import { cartTotals, lineStatus, packsRefusal } from './cart-rules';
import type { LineStatus } from './cart-rules';

export const PACK_NOT_FOUND = 'Pack size not found';

// One line of a cart as the customer sees it: the pack size by its SKU,
// with today's prices, and whether it can be bought now. Never an ID.
export interface CartLine {
  product: { name: string; slug: string; imageUrl: string | null };
  sku: string;
  quantity: number;
  unit: PackUnit;
  mrpRupees: number;
  priceRupees: number;
  packs: number;
  lineTotalRupees: number;
  status: LineStatus;
}

// The whole cart: its lines, and what the lines that can be bought now
// come to.
export interface CartView {
  items: CartLine[];
  packs: number;
  subtotalRupees: number;
  mrpTotalRupees: number;
}

// The order of a cart's lines: the first added first.
const LINE_ORDER = [
  { createdAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.CartItemOrderByWithRelationInput[];

// A signed-in customer's cart (ADR 0025). It asks the catalog about pack
// sizes and the inventory about stock, never their tables. It keeps no
// prices, which are always today's, and holds no stock: stock is held only
// when an order is placed.
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly packs: ShopPacksService,
    private readonly stock: StockService,
  ) {}

  // The customer's cart, the first added first, with today's prices. Only
  // the lines that can be bought now count in the totals. A customer
  // without a cart has an empty one.
  async view(userId: string): Promise<CartView> {
    const items = await this.prisma.cartItem.findMany({
      where: { cart: { userId } },
      orderBy: LINE_ORDER,
      select: { variantId: true, packs: true },
    });
    const variantIds = items.map((item) => item.variantId);
    const [packs, inStock] = await Promise.all([
      this.packs.findByIds(variantIds),
      this.stock.inStock(variantIds),
    ]);
    const byId = new Map(packs.map((pack) => [pack.variantId, pack]));
    const lines = items.flatMap((item): CartLine[] => {
      const pack = byId.get(item.variantId);
      // Deleted a moment ago: its line went with it.
      if (!pack) {
        return [];
      }
      return [
        {
          product: pack.product,
          sku: pack.sku,
          quantity: pack.quantity,
          unit: pack.unit,
          mrpRupees: pack.mrpRupees,
          priceRupees: pack.priceRupees,
          packs: item.packs,
          lineTotalRupees: item.packs * pack.priceRupees,
          status: lineStatus(pack.onSale, inStock.has(item.variantId)),
        },
      ];
    });
    return { items: lines, ...cartTotals(lines) };
  }

  // Puts this many packs of a pack size in the customer's cart, or changes
  // how many it holds, and answers the cart. Only a pack size sold now:
  // any other answers 404, like an unknown SKU. Adding needs stock and
  // room (cart-rules.ts); fewer packs are always fine. The cart is made
  // with its first pack, and locked until the change is saved, so two
  // changes to one cart take turns and the limits count both.
  async setPacks(
    userId: string,
    sku: string,
    packs: number,
  ): Promise<CartView> {
    const pack = await this.packs.findBySku(sku);
    if (!pack || !pack.onSale) {
      throw new NotFoundException(PACK_NOT_FOUND);
    }
    const inStock = (await this.stock.inStock([pack.variantId])).has(
      pack.variantId,
    );
    await this.prisma.$transaction(async (tx) => {
      const cartId = await this.lockedCart(tx, userId);
      const items = await tx.cartItem.findMany({
        where: { cartId },
        select: { variantId: true, packs: true },
      });
      const sameProduct = new Set(pack.productVariantIds);
      let currentPacks = 0;
      let otherPacks = 0;
      for (const item of items) {
        if (item.variantId === pack.variantId) {
          currentPacks = item.packs;
        } else if (sameProduct.has(item.variantId)) {
          otherPacks += item.packs;
        }
      }
      const refusal = packsRefusal({
        packs,
        currentPacks,
        otherPacks,
        lines: items.length,
        inStock,
      });
      if (refusal) {
        throw new ConflictException(refusal);
      }
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId, variantId: pack.variantId } },
        create: { cartId, variantId: pack.variantId, packs },
        update: { packs },
      });
    });
    return this.view(userId);
  }

  // Takes a pack size out of the customer's cart, sold now or not. One
  // that is not in the cart, or no longer exists, needs nothing done.
  async remove(userId: string, sku: string): Promise<void> {
    const pack = await this.packs.findBySku(sku);
    if (!pack) {
      return;
    }
    await this.prisma.$transaction([
      this.prisma.cart.updateMany({
        where: { userId },
        data: { updatedAt: new Date() },
      }),
      this.prisma.cartItem.deleteMany({
        where: { cart: { userId }, variantId: pack.variantId },
      }),
    ]);
  }

  // Empties the customer's cart: the cart goes, with its lines.
  async empty(userId: string): Promise<void> {
    await this.prisma.cart.deleteMany({ where: { userId } });
  }

  // The cart's lines, the first added first, for a look at checkout
  // (ADR 0026). Looking changes nothing.
  async lines(userId: string): Promise<{ variantId: string; packs: number }[]> {
    return this.linesIn(this.prisma, userId);
  }

  // For an order (ADR 0026): marks the customer's cart as changed, which
  // locks it until the order's transaction ends, so the cart cannot change
  // while the order is placed. Then its lines, the first added first. A
  // customer without a cart has none.
  async lockedLines(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<{ variantId: string; packs: number }[]> {
    await tx.cart.updateMany({
      where: { userId },
      data: { updatedAt: new Date() },
    });
    return this.linesIn(tx, userId);
  }

  // Empties the cart in an order's transaction: the order holds its packs
  // now.
  async clear(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.cart.deleteMany({ where: { userId } });
  }

  // The customer's cart lines, read in or outside a transaction.
  private linesIn(
    client: Prisma.TransactionClient,
    userId: string,
  ): Promise<{ variantId: string; packs: number }[]> {
    return client.cartItem.findMany({
      where: { cart: { userId } },
      orderBy: LINE_ORDER,
      select: { variantId: true, packs: true },
    });
  }

  // The customer's cart, made if it does not exist yet, marked as changed
  // now, and locked until the transaction ends. One statement does all
  // three, so two first packs at once still make one cart. A refused
  // change rolls it back, so it never leaves an empty cart behind. The ID
  // is sent as a parameter, never pasted into the SQL.
  private async lockedCart(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<string> {
    const [cart] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO carts (id, "userId", "updatedAt")
      VALUES (gen_random_uuid(), ${userId}::uuid, CURRENT_TIMESTAMP)
      ON CONFLICT ("userId") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP
      RETURNING id`;
    return cart.id;
  }
}
