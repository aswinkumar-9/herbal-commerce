import { Injectable } from '@nestjs/common';
import type { AuditLog, UserRole } from '../generated/prisma/client';
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
}

// The account an ID in an entry belongs to, if it still exists.
export interface AuditPerson {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

export type AuditLogEntry = AuditLog & {
  actor: AuditPerson | null;
  target: AuditPerson | null;
};

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
      },
      // The ID breaks ties, so the order is the same on every page.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One more than asked for, to know whether an older page exists.
      take: query.limit + 1,
      // Start at the given entry, but skip it: it was on the last page.
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });

    const entries = rows.slice(0, query.limit);
    const people = await this.peopleIn(entries);
    return {
      entries: entries.map((entry) => ({
        ...entry,
        actor: entry.actorId ? (people.get(entry.actorId) ?? null) : null,
        target:
          entry.targetType === 'user' && entry.targetId
            ? (people.get(entry.targetId) ?? null)
            : null,
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
}
