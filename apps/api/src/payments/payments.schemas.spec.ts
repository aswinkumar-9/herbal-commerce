import { refundListQuerySchema } from './payments.schemas';

const AFTER = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f101';

// The errors an invalid input gets, as "field: message".
function refusals(input: unknown): string[] {
  const result = refundListQuerySchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      );
}

describe('refundListQuerySchema', () => {
  it('pages 50 refunds by default, up to 100, continuing after a refund ID, and drops the rest', () => {
    expect(refundListQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      refundListQuerySchema.parse({
        limit: '100',
        after: AFTER,
        status: 'FAILED',
        other: 'dropped',
      }),
    ).toEqual({ limit: 100, after: AFTER, status: 'FAILED' });
    for (const query of [{ limit: '101' }, { limit: '0' }, { after: 'last' }]) {
      expect(refusals(query).map((r) => r.split(':')[0])).toEqual(
        Object.keys(query),
      );
    }
  });

  it('takes every refund status, and refuses anything else, saying what to send', () => {
    for (const status of ['REQUESTED', 'PENDING', 'PROCESSED', 'FAILED']) {
      expect(refundListQuerySchema.parse({ status }).status).toBe(status);
    }
    for (const status of ['failed', 'REFUNDED']) {
      expect(refusals({ status })).toEqual([
        'status: Use REQUESTED, PENDING, PROCESSED or FAILED',
      ]);
    }
  });
});
