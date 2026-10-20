import { randomUUID } from 'node:crypto';

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

// Reuse a client-supplied ID only if it is clearly safe to put in logs.
export function resolveRequestId(incoming: unknown): string {
  if (typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}
