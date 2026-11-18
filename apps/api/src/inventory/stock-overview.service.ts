import { Injectable } from '@nestjs/common';
import { validationFailed } from '../catalog/validation-failed';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  holdsOf,
  LINE_FIELDS,
  NO_HOLDS,
  stockLine,
  summarise,
} from './stock-lines';
import type { StockLine } from './stock-lines';
import type { StockFilter, StockListQuery } from './stock.schemas';

export const START_AGAIN =
  'This pack size is no longer in the list: start from the first page';

// Words to look for as they are: Prisma's contains is SQL's LIKE, where %
// and _ match anything and \ escapes. Searching for "100%" must not find
// every name with "100" in it.
export function asTyped(words: string): string {
  return words.replace(/[\\%_]/g, (letter) => `\\${letter}`);
}

// Whether a pack size's stock matches the Stock page's filter.
const MATCHES: Record<StockFilter, (line: StockLine) => boolean> = {
  out: (line) => line.stock.level === 'OUT',
  low: (line) => line.stock.level !== 'OK',
  expiring: (line) => line.stock.expiringSoon,
};

// The Stock page (ADR 0034): every pack size with its stock, drafts and
// those off sale too, by product name, then in the product's own order.
// The stock is summed from the batches each time, so it is never out of
// date; a shop's few thousand pack sizes are read in one go.
@Injectable()
export class StockOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: StockListQuery,
  ): Promise<{ lines: StockLine[]; nextAfter: string | null }> {
    const now = new Date();
    // The words are a value Prisma sends as a parameter.
    const words = query.q ? asTyped(query.q) : undefined;
    const where: Prisma.ProductVariantWhereInput = {
      ...(query.productId ? { productId: query.productId } : {}),
      ...(words
        ? {
            OR: [
              { sku: { contains: words, mode: 'insensitive' } },
              { product: { name: { contains: words, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const variants = await this.prisma.productVariant.findMany({
      where,
      orderBy: [
        { product: { name: 'asc' } },
        { productId: 'asc' },
        { position: 'asc' },
        { id: 'asc' },
      ],
      select: {
        ...LINE_FIELDS,
        batches: { select: { id: true, expiresOn: true, quantity: true } },
      },
    });
    // The page goes on after the pack size the last one ended with, even
    // if its stock changed since and it no longer matches the filter.
    const start = query.after
      ? variants.findIndex((variant) => variant.id === query.after) + 1
      : 0;
    if (start === 0 && query.after) {
      throw validationFailed([{ field: 'after', message: START_AGAIN }]);
    }
    const holds = await holdsOf(
      this.prisma,
      variants.flatMap((variant) => variant.batches.map((batch) => batch.id)),
    );
    const matches = query.status ? MATCHES[query.status] : () => true;
    const lines: StockLine[] = [];
    let more = false;
    for (const { batches, ...variant } of variants.slice(start)) {
      const line = stockLine(
        variant,
        summarise(
          batches.map((batch) => ({
            ...batch,
            holds: holds.get(batch.id) ?? NO_HOLDS,
          })),
          variant.lowStockAt,
          now,
        ),
      );
      if (!matches(line)) {
        continue;
      }
      if (lines.length === query.limit) {
        more = true;
        break;
      }
      lines.push(line);
    }
    return {
      lines,
      nextAfter: more ? lines[lines.length - 1].variant.id : null,
    };
  }
}
