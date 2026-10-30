import type { AuthUser } from '../auth/auth-user';
import { clientAddress } from '../rate-limit/client-ip';
import type { AuditEntry } from './audit.service';

// Who acted, from which address, in which request: the part of an audit entry
// that the HTTP request knows. The service that makes the change adds what
// was done.
export type AuditContext = Pick<AuditEntry, 'actorId' | 'ip' | 'requestId'>;

export function auditContextOf(request: {
  user?: AuthUser;
  id?: string | number;
  ip?: string;
  socket?: { remoteAddress?: string };
}): AuditContext {
  return {
    // The caller the access-token guard checked, never an ID from the body.
    actorId: request.user?.id,
    ip: clientAddress(request),
    // The ID in the request logs, so an entry can be matched to its log
    // lines. Clients may choose it, so it is never trusted for anything else.
    requestId: request.id === undefined ? undefined : String(request.id),
  };
}
