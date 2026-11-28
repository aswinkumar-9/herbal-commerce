import { Injectable } from '@nestjs/common';
import type { Prisma, PackUnit } from '../generated/prisma/client';
import { labelDay } from '../inventory/stock-lines';
import {
  isSellable,
  stockLevel,
  stopsSellingOn,
  todayInIndia,
  type StockLevel,
} from '../inventory/stock-rules';
import { PrismaService } from '../prisma/prisma.service';
import type { SalesReportQuery } from './reports.schemas';
import { daysIn } from './sales-periods';
import {
  filterOf,
  type Period,
  type SalesFilter,
  type SalesFilters,
  SalesReportService,
} from './sales-report.service';

// The batches the report warns of: those that stop selling within this
// many days, and those that already have but still hold packs (part 15E).
export const SHELF_LIFE_DAYS = 90;

const DAY_MS = 86_400_000;

// One pack size's stock beside how fast it sold in the period.
export interface StockPackSize {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unit: PackUnit;
  // On sale: the pack size and its product both live.
  onSale: boolean;
  // Free to sell now, in the batches that may be sold today.
  sellable: number;
  lowStockAt: number;
  level: StockLevel;
  // Packs paid for in the period, less those of cancelled orders given
  // back in it, as the sales summaries count them.
  soldPacks: number;
  // How many days the packs that may be sold last at the period's rate;
  // none when nothing sold.
  daysOfCover: number | null;
}

// A batch near the end of its selling life, or past it, still holding
// packs.
export interface ShelfLifeBatch {
  batchId: string;
  variantId: string;
  productName: string;
  sku: string;
  quantity: number;
  unit: PackUnit;
  batchNumber: string;
  expiresOn: string;
  // The first day it may no longer be sold (6 months before it expires).
  stopsSellingOn: string;
  packs: number;
  // Days until then: 0 or less once it has stopped.
  daysLeft: number;
  // The packs still in it on that day at the period's rate, the batches
  // that expire first being sold first. All of them once it has stopped.
  leftOver: number;
}

export interface StockReport {
  period: Period;
  filters: SalesFilters;
  // When the stock was read: everything here is live.
  readAt: Date;
  // The days of the period up to today, over which the sales rate is
  // taken.
  rateDays: number;
  totals: {
    // Of the pack sizes on sale.
    packSizes: number;
    out: number;
    low: number;
    sellablePacks: number;
    // What the packs that may be sold would fetch at today's prices, GST
    // included.
    sellableRupees: number;
    // Packs on the shelf in batches that may no longer be sold, of any
    // pack size.
    unsellablePacks: number;
  };
  // Every pack size the filter keeps, on sale or not, the least cover
  // first, those that did not sell after, then by name.
  packSizes: StockPackSize[];
  // The batches that stop selling within SHELF_LIFE_DAYS or have stopped,
  // still holding packs, the first to stop first.
  shelfLife: ShelfLifeBatch[];
}

const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / DAY_MS);

// The pack sizes a filter keeps: those of a product, a category's own
// products and its subcategories', or a brand's, as the catalog has them
// now. A state or a way of paying never narrows the stock: the shop keeps
// one store for all.
function variantsOf(
  filter: SalesFilter | null,
): Prisma.ProductVariantWhereInput {
  return {
    ...(filter?.productId ? { productId: filter.productId } : {}),
    ...(filter?.brandId || filter?.categoryId
      ? {
          product: {
            ...(filter.brandId ? { brandId: filter.brandId } : {}),
            ...(filter.categoryId
              ? {
                  OR: [
                    { categoryId: filter.categoryId },
                    { category: { parentId: filter.categoryId } },
                  ],
                }
              : {}),
          },
        }
      : {}),
  };
}

// Most urgent first: the least cover, then those that did not sell, then
// by name and pack.
function byCover(a: StockPackSize, b: StockPackSize): number {
  if (a.daysOfCover !== b.daysOfCover) {
    if (a.daysOfCover === null) {
      return 1;
    }
    if (b.daysOfCover === null) {
      return -1;
    }
    return a.daysOfCover - b.daysOfCover;
  }
  return (
    a.productName.localeCompare(b.productName) || a.sku.localeCompare(b.sku)
  );
}

@Injectable()
export class StockReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesReportService,
  ) {}

  // The stock for Super Users (part 15E), read live from the batches,
  // beside how fast each pack size sold in the period. In one snapshot.
  stock(query: SalesReportQuery, now = new Date()): Promise<StockReport> {
    return this.prisma.$transaction(async (tx) => this.read(tx, query, now), {
      isolationLevel: 'RepeatableRead',
    });
  }

  private async read(
    tx: Prisma.TransactionClient,
    { from, to, ...asked }: SalesReportQuery,
    now: Date,
  ): Promise<StockReport> {
    const filter = filterOf(asked);
    const today = todayInIndia(now);
    const lastDay = to < labelDay(today) ? to : labelDay(today);
    const rateDays = from <= lastDay ? daysIn(from, lastDay) : 0;

    const variants = await tx.productVariant.findMany({
      where: variantsOf(filter),
      select: {
        id: true,
        sku: true,
        quantity: true,
        unit: true,
        isActive: true,
        lowStockAt: true,
        priceRupees: true,
        product: { select: { id: true, name: true, isActive: true } },
        batches: {
          where: { quantity: { gt: 0 } },
          orderBy: [{ expiresOn: 'asc' }, { batchNumber: 'asc' }],
          select: {
            id: true,
            batchNumber: true,
            expiresOn: true,
            quantity: true,
          },
        },
      },
    });
    const sold = await this.soldPacks(tx, from, lastDay, rateDays);

    const totals: StockReport['totals'] = {
      packSizes: 0,
      out: 0,
      low: 0,
      sellablePacks: 0,
      sellableRupees: 0,
      unsellablePacks: 0,
    };
    const packSizes: StockPackSize[] = [];
    const shelfLife: ShelfLifeBatch[] = [];
    const warnFrom = new Date(today.getTime() + SHELF_LIFE_DAYS * DAY_MS);

    for (const variant of variants) {
      const sellable = variant.batches
        .filter((batch) => isSellable(batch.expiresOn, now))
        .reduce((sum, batch) => sum + batch.quantity, 0);
      const soldPacks = sold.get(variant.id) ?? 0;
      const perDay = rateDays > 0 ? Math.max(0, soldPacks) / rateDays : 0;
      const onSale = variant.isActive && variant.product.isActive;
      const level = stockLevel(sellable, variant.lowStockAt);
      packSizes.push({
        variantId: variant.id,
        productId: variant.product.id,
        productName: variant.product.name,
        sku: variant.sku,
        quantity: variant.quantity,
        unit: variant.unit,
        onSale,
        sellable,
        lowStockAt: variant.lowStockAt,
        level,
        soldPacks,
        daysOfCover: perDay > 0 ? Math.floor(sellable / perDay) : null,
      });
      if (onSale) {
        totals.packSizes += 1;
        totals.out += level === 'OUT' ? 1 : 0;
        totals.low += level === 'LOW' ? 1 : 0;
        totals.sellablePacks += sellable;
        totals.sellableRupees += sellable * variant.priceRupees;
      }

      // The packs sold before each batch stops selling, the first to
      // expire going first.
      let soldEarlier = 0;
      for (const batch of variant.batches) {
        const stops = stopsSellingOn(batch.expiresOn);
        const daysLeft = daysBetween(today, stops);
        const selling = daysLeft > 0;
        if (!selling) {
          totals.unsellablePacks += batch.quantity;
        }
        const fromThis = selling
          ? Math.min(
              batch.quantity,
              Math.max(0, Math.floor(perDay * daysLeft) - soldEarlier),
            )
          : 0;
        if (selling) {
          soldEarlier += batch.quantity;
        }
        if (stops.getTime() > warnFrom.getTime()) {
          continue;
        }
        shelfLife.push({
          batchId: batch.id,
          variantId: variant.id,
          productName: variant.product.name,
          sku: variant.sku,
          quantity: variant.quantity,
          unit: variant.unit,
          batchNumber: batch.batchNumber,
          expiresOn: labelDay(batch.expiresOn),
          stopsSellingOn: labelDay(stops),
          packs: batch.quantity,
          daysLeft,
          leftOver: batch.quantity - fromThis,
        });
      }
    }

    packSizes.sort(byCover);
    shelfLife.sort(
      (a, b) =>
        a.stopsSellingOn.localeCompare(b.stopsSellingOn) ||
        a.productName.localeCompare(b.productName) ||
        a.batchNumber.localeCompare(b.batchNumber),
    );
    return {
      period: { from, to },
      filters: await this.sales.filtersOf(tx, filter, []),
      readAt: now,
      rateDays,
      totals,
      packSizes,
      shelfLife,
    };
  }

  // The packs of each pack size paid for in the days, less those of
  // cancelled orders given back in them, as the sales summaries count
  // them: payments on their day in India, refunds of the payment that paid
  // on theirs. Read live.
  private async soldPacks(
    tx: Prisma.TransactionClient,
    from: string,
    to: string,
    days: number,
  ): Promise<Map<string, number>> {
    if (days === 0) {
      return new Map();
    }
    const rows = await tx.$queryRaw<{ variantId: string; packs: number }[]>`
      WITH "events" AS (
        SELECT p."orderId", 1 AS "sign"
          FROM "payments" p
         WHERE p."paidAt" >= ${from}::date - INTERVAL '330 minutes'
           AND p."paidAt" < (${to}::date + 1) - INTERVAL '330 minutes'
        UNION ALL
        SELECT p."orderId", -1
          FROM "refunds" r
          JOIN "payments" p ON p."razorpayPaymentId" = r."razorpayPaymentId"
         WHERE r."createdAt" >= ${from}::date - INTERVAL '330 minutes'
           AND r."createdAt" < (${to}::date + 1) - INTERVAL '330 minutes'
      )
      SELECT i."variantId"::text AS "variantId",
             sum(e."sign" * i."packs")::int AS "packs"
        FROM "events" e
        JOIN "order_items" i ON i."orderId" = e."orderId"
       GROUP BY i."variantId"`;
    return new Map(rows.map((row) => [row.variantId, row.packs]));
  }
}
