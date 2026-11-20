import { givenBackSchema, refundListQuerySchema } from './payments.schemas';

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

describe('refundListQuerySchema givenBack (ADR 0038)', () => {
  it('takes true or false as text, and refuses anything else', () => {
    expect(refundListQuerySchema.parse({ givenBack: 'false' }).givenBack).toBe(false);
    expect(refundListQuerySchema.parse({ givenBack: 'true' }).givenBack).toBe(true);
    for (const givenBack of ['no', '0', 'TRUE', '']) {
      expect(refusals({ givenBack })).toEqual(['givenBack: Use true or false']);
    }
  });
});

describe('givenBackSchema (ADR 0038)', () => {
  const RULE = 'Say how the money was given back, in 3 to 500 characters';
  function noteRefusals(input: unknown): string[] {
    const result = givenBackSchema.safeParse(input);
    return result.success
      ? []
      : result.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        );
  }

  it('keeps the note, without spaces or line breaks at its ends, Windows line breaks made plain, and drops the rest', () => {
    expect(
      givenBackSchema.parse({
        note: '  \r\nBank transfer\r\nUTR 412345678901 \n',
        givenBackById: 'dropped',
      }),
    ).toEqual({ note: 'Bank transfer\nUTR 412345678901' });
  });

  it('takes 3 to 500 characters, counted without the spaces at the ends', () => {
    expect(givenBackSchema.parse({ note: 'UPI' }).note).toBe('UPI');
    expect(givenBackSchema.parse({ note: 'x'.repeat(500) }).note).toHaveLength(500);
    for (const note of ['', '   ', ' ok ', 'x'.repeat(501)]) {
      expect(noteRefusals({ note })).toEqual([`note: ${RULE}`]);
    }
  });

  it('asks for the note when it is missing or not text', () => {
    for (const input of [{}, { note: 42 }, { note: null }]) {
      expect(noteRefusals(input)).toEqual(['note: Say how the money was given back']);
    }
  });
});
