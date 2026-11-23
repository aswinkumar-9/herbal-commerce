import { Injectable } from '@nestjs/common';
import type { AuditLog, Prisma, UserRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// What a Super User may ask for. The filters are optional and combine.
export interface AuditLogQuery {
  limit: number;
  // The ID of the last entry on the previous page: the next page starts
  // just after it.
  before?: string;
  action?: string;
  actorId?: string;
  targetId?: string;
  // One kind of change only (ADR 0038), such as everything about orders.
  kind?: AuditKind;
}

// The kinds of change a Super User can ask for, each the actions it covers.
// Signing in is its own kind: it happens far more often than the rest. A
// prefix with "_" in it is never used: startsWith becomes SQL's LIKE, where
// "_" stands for any character, so those actions are named in full.
const KINDS = {
  accounts: [
    { action: { startsWith: 'admin.' } },
    { action: 'super_user.created' },
    { action: 'staff.mfa_set_up' },
  ],
  sign_ins: [{ action: 'staff.signed_in' }],
  orders: [{ action: { startsWith: 'order.' } }],
  catalog: [
    { action: { startsWith: 'category.' } },
    { action: { startsWith: 'brand.' } },
    { action: { startsWith: 'product.' } },
    { action: { startsWith: 'variant.' } },
    { action: { startsWith: 'image.' } },
  ],
  stock: [
    { action: { startsWith: 'batch.' } },
    { action: { startsWith: 'stock.' } },
  ],
  // The website's policy pages (ADR 0040).
  policies: [{ action: { startsWith: 'policy.' } }],
} satisfies Record<string, Prisma.AuditLogWhereInput[]>;
export type AuditKind = keyof typeof KINDS;
export const AUDIT_KINDS = Object.keys(KINDS) as [AuditKind, ...AuditKind[]];

// The account an ID in an entry belongs to, if it still exists.
export interface AuditPerson {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

// What a target is called now, so the console can say it in words: the
// product's name, the order's reference, a batch's number. The parent is
// what it belongs to: a pack size's or an image's product, a batch's pack
// size. Null when the thing is gone, or is not one of these.
export interface AuditSubject {
  name: string | null;
  parent: { id: string; name: string } | null;
}

export type AuditLogEntry = AuditLog & {
  actor: AuditPerson | null;
  target: AuditPerson | null;
  subject: AuditSubject | null;
};

// The targets whose names are looked up.
const NAMED = [
  'category',
  'brand',
  'product',
  'variant',
  'image',
  'batch',
  'order',
];

export interface AuditLogPage {
  entries: AuditLogEntry[];
  // Pass it as `before` to get the next, older page; null on the last page.
  nextBefore: string | null;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reads the audit log for Super Users (ADR 0017). Writing stays with
// AuditService, inside the transaction of each change.
@Injectable()
export class AuditReaderService {
  constructor(private readonly prisma: PrismaService) {}

  // Newest first, one page at a time. Reading is not audited.
  async list(query: AuditLogQuery): Promise<AuditLogPage> {
    const rows = await this.prisma.auditLog.findMany({
      // A filter left out is undefined, and Prisma ignores it.
      where: {
        action: query.action,
        actorId: query.actorId,
        targetId: query.targetId,
        ...(query.kind ? { OR: KINDS[query.kind] } : {}),
      },
      // The ID breaks ties, so the order is the same on every page.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One more than asked for, to know whether an older page exists.
      take: query.limit + 1,
      // Start at the given entry, but skip it: it was on the last page.
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });

    const entries = rows.slice(0, query.limit);
    const [people, subjects] = await Promise.all([
      this.peopleIn(entries),
      this.subjectsIn(entries),
    ]);
    return {
      entries: entries.map((entry) => ({
        ...entry,
        actor: entry.actorId ? (people.get(entry.actorId) ?? null) : null,
        target:
          entry.targetType === 'user' && entry.targetId
            ? (people.get(entry.targetId) ?? null)
            : null,
        subject: subjects.get(`${entry.targetType}:${entry.targetId}`) ?? null,
      })),
      nextBefore:
        rows.length > query.limit ? entries[entries.length - 1].id : null,
    };
  }

  // The accounts the entries name, in one query. A removed account is not
  // found: its entries keep the ID, and its admin.removed entry says who it
  // was (ADR 0016).
  private async peopleIn(
    entries: AuditLog[],
  ): Promise<Map<string, AuditPerson>> {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (entry.actorId) {
        ids.add(entry.actorId);
      }
      // Only user targets are looked up, and only well-formed IDs: the
      // database would refuse anything else in a UUID comparison.
      const userTarget = entry.targetType === 'user' && entry.targetId;
      if (userTarget && UUID.test(userTarget)) {
        ids.add(userTarget);
      }
    }
    if (ids.size === 0) {
      return new Map();
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, email: true, fullName: true, role: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  // What the named targets are called now, in one query for each kind that
  // appears. Keyed by "type:id".
  private async subjectsIn(
    entries: AuditLog[],
  ): Promise<Map<string, AuditSubject>> {
    const ids = new Map<string, string[]>();
    for (const { targetType, targetId } of entries) {
      if (
        targetType &&
        targetId &&
        NAMED.includes(targetType) &&
        UUID.test(targetId)
      ) {
        ids.set(targetType, [...(ids.get(targetType) ?? []), targetId]);
      }
    }
    const among = (type: string) => ({ id: { in: ids.get(type) ?? [] } });
    const asked = (type: string) => ids.has(type);
    const [categories, brands, products, variants, images, batches, orders] =
      await Promise.all([
        asked('category')
          ? this.prisma.category.findMany({
              where: among('category'),
              select: { id: true, name: true },
            })
          : [],
        asked('brand')
          ? this.prisma.brand.findMany({
              where: among('brand'),
              select: { id: true, name: true },
            })
          : [],
        asked('product')
          ? this.prisma.product.findMany({
              where: among('product'),
              select: { id: true, name: true },
            })
          : [],
        asked('variant')
          ? this.prisma.productVariant.findMany({
              where: among('variant'),
              select: {
                id: true,
                sku: true,
                product: { select: { id: true, name: true } },
              },
            })
          : [],
        asked('image')
          ? this.prisma.productImage.findMany({
              where: among('image'),
              select: {
                id: true,
                altText: true,
                product: { select: { id: true, name: true } },
              },
            })
          : [],
        asked('batch')
          ? this.prisma.stockBatch.findMany({
              where: among('batch'),
              select: {
                id: true,
                batchNumber: true,
                variant: { select: { id: true, sku: true } },
              },
            })
          : [],
        asked('order')
          ? this.prisma.order.findMany({
              where: among('order'),
              select: { id: true, reference: true },
            })
          : [],
      ]);

    const subjects = new Map<string, AuditSubject>();
    for (const { id, name } of categories) {
      subjects.set(`category:${id}`, { name, parent: null });
    }
    for (const { id, name } of brands) {
      subjects.set(`brand:${id}`, { name, parent: null });
    }
    for (const { id, name } of products) {
      subjects.set(`product:${id}`, { name, parent: null });
    }
    for (const { id, sku, product } of variants) {
      subjects.set(`variant:${id}`, { name: sku, parent: product });
    }
    for (const { id, altText, product } of images) {
      subjects.set(`image:${id}`, { name: altText, parent: product });
    }
    for (const { id, batchNumber, variant } of batches) {
      subjects.set(`batch:${id}`, {
        name: batchNumber,
        parent: { id: variant.id, name: variant.sku },
      });
    }
    for (const { id, reference } of orders) {
      subjects.set(`order:${id}`, { name: reference, parent: null });
    }
    return subjects;
  }
}
