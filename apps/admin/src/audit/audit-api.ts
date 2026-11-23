import { z } from 'zod';
import { apiRequest } from '../api/client';

// The audit log, for Super Users only (ADR 0017, ADR 0038): who did what,
// and when, newest first, a page at a time. Nothing in it can be changed.

const AUDIT_LOG = '/v1/staff/audit-log';

// The kinds of change the log can be narrowed to.
export const AUDIT_KINDS = [
  'accounts',
  'sign_ins',
  'orders',
  'catalog',
  'stock',
  'policies',
] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

const person = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(['CUSTOMER', 'ADMIN', 'SUPER_USER']),
});
export type AuditPerson = z.infer<typeof person>;

// The fields a change touched, as they were and as they became. Plain JSON:
// dates come as text.
const fields = z.record(z.string(), z.unknown()).nullable();
export type AuditFields = z.infer<typeof fields>;

const entrySchema = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(),
  actorId: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  before: fields,
  after: fields,
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  // Who acted, and the account changed, while they still exist.
  actor: person.nullable(),
  target: person.nullable(),
  // What the target is called now, and what it belongs to.
  subject: z
    .object({
      name: z.string().nullable(),
      parent: z.object({ id: z.string(), name: z.string() }).nullable(),
    })
    .nullable(),
});
export type AuditEntry = z.infer<typeof entrySchema>;

const pageSchema = z.object({
  entries: z.array(entrySchema),
  nextBefore: z.string().nullable(),
});
export type AuditPage = z.infer<typeof pageSchema>;

export interface AuditQuery {
  kind?: AuditKind;
  actorId?: string;
  targetId?: string;
  // The last entry of the page before: the next page starts after it.
  before?: string;
  limit?: number;
}

export function listAudit(
  query: AuditQuery,
  signal?: AbortSignal,
): Promise<AuditPage> {
  const search = new URLSearchParams();
  for (const name of [
    'kind',
    'actorId',
    'targetId',
    'before',
    'limit',
  ] as const) {
    const value = query[name];
    if (value !== undefined) {
      search.set(name, String(value));
    }
  }
  const text = search.toString();
  return apiRequest(text ? `${AUDIT_LOG}?${text}` : AUDIT_LOG, {
    schema: pageSchema,
    signal,
  });
}
