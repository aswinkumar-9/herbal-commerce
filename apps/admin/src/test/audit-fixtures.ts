import type { AuditEntry } from '../audit/audit-api';
import { json } from './fake-api';

// Audit log entries as the API sends them.

export const AUDIT = (search = '') => `GET /v1/staff/audit-log${search}`;

export const RAVI_PERSON = {
  id: 'staff-2',
  email: 'ravi@example.com',
  fullName: 'Ravi Kumar',
  role: 'SUPER_USER',
} as const;
export const ASHA_PERSON = {
  id: '6a000000-0000-4000-8000-000000000001',
  email: 'asha@example.com',
  fullName: 'Asha Verma',
  role: 'ADMIN',
} as const;
export const ORDER_ID = '0f000000-0000-4000-8000-000000000001';
export const PRODUCT_ID = '0b000000-0000-4000-8000-000000000001';
export const VARIANT_ID = '0d000000-0000-4000-8000-000000000001';

let made = 0;
// An entry by Asha, at 15:35 in India on 19 Nov 2026 unless told otherwise.
export function entryOf(changes: Partial<AuditEntry>): AuditEntry {
  made += 1;
  return {
    id: `e${made.toString().padStart(3, '0')}00000-0000-4000-8000-000000000000`,
    createdAt: '2026-11-19T10:05:00.000Z',
    actorId: ASHA_PERSON.id,
    action: 'order.packed',
    targetType: 'order',
    targetId: ORDER_ID,
    before: { status: 'PAID' },
    after: { status: 'PACKED' },
    ip: '203.0.113.7',
    requestId: 'req-1',
    actor: ASHA_PERSON,
    target: null,
    subject: { name: '7KQ2M9XDPA', parent: null },
    ...changes,
  };
}

export const auditOf =
  (entries: AuditEntry[], nextBefore: string | null = null) =>
  () =>
    json(200, { entries, nextBefore });
