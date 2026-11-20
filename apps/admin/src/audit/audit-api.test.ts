import { describe, expect, it } from 'vitest';
import { setAccessToken } from '../api/access-token';
import { AUDIT, ORDER_ID, auditOf, entryOf } from '../test/audit-fixtures';
import { fakeApi, json } from '../test/fake-api';
import { listAudit } from './audit-api';

const NOT_UNDERSTOOD =
  'The server sent an answer the console does not understand.';

describe('reading the audit log', () => {
  it('asks with only the filters given, in the API’s words', async () => {
    setAccessToken('t1');
    const entry = entryOf({});
    const api = fakeApi({
      [AUDIT()]: auditOf([entry]),
      [AUDIT(
        `?kind=orders&actorId=${entry.actorId}&targetId=${ORDER_ID}&before=${entry.id}&limit=20`,
      )]: auditOf([]),
    });

    await expect(listAudit({})).resolves.toEqual({
      entries: [entry],
      nextBefore: null,
    });
    await expect(
      listAudit({
        kind: 'orders',
        actorId: entry.actorId ?? '',
        targetId: ORDER_ID,
        before: entry.id,
        limit: 20,
      }),
    ).resolves.toEqual({ entries: [], nextBefore: null });
    expect(api.unexpected).toEqual([]);
  });

  it('refuses an answer it does not understand', async () => {
    setAccessToken('t1');
    fakeApi({
      [AUDIT()]: [
        () =>
          json(200, {
            entries: [{ ...entryOf({}), createdAt: 'today' }],
            nextBefore: null,
          }),
        () =>
          json(200, {
            entries: [{ ...entryOf({}), before: 'a string' }],
            nextBefore: null,
          }),
      ],
    });

    await expect(listAudit({})).rejects.toThrow(NOT_UNDERSTOOD);
    await expect(listAudit({})).rejects.toThrow(NOT_UNDERSTOOD);
  });
});
