import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';

// One entry in the audit log: who did what, to what, and from where.
export interface AuditEntry {
  // The staff user who acted, or none for a developer command or the system.
  actorId?: string;
  // What happened, as "thing.verb", for example "super_user.created".
  action: string;
  targetType?: string;
  targetId?: string;
  // The relevant fields before and after the change.
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string;
  requestId?: string;
}

// Only what writing an entry needs, so the open transaction fits.
export type AuditWriter = Pick<Prisma.TransactionClient, 'auditLog'>;

// Field names that must never reach the log, at any depth.
const SECRET_KEY = /password|secret|token/i;

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? '[REDACTED]' : redactSecrets(item),
      ]),
    );
  }
  return value;
}

// Plain JSON (dates become strings), with every secret-looking field
// replaced. The log is append-only, so a secret written by mistake could
// never be removed again.
function safeJson(
  value: Prisma.InputJsonValue | undefined,
): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  const plain: unknown = JSON.parse(JSON.stringify(value));
  return redactSecrets(plain) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  // Pass the transaction that makes the change: the change and its entry
  // are then saved together, or not at all.
  async record(tx: AuditWriter, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        ...entry,
        before: safeJson(entry.before),
        after: safeJson(entry.after),
      },
    });
  }
}
