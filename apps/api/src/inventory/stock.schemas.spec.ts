import {
  batchSchema,
  batchUpdateSchema,
  movementListQuerySchema,
  movementSchema,
} from './stock.schemas';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const batch = {
  batchNumber: ' ab 2611 ',
  manufacturedOn: '2026-10-01',
  expiresOn: '2028-09-30',
  quantity: 120,
};

// The errors an invalid input gets, as "field: message".
function refusals(schema: { safeParse: (input: unknown) => unknown }, input: object): string[] {
  const result = schema.safeParse(input) as {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  };
  return result.success
    ? []
    : (result.error?.issues ?? []).map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      );
}
const fields = (schema: { safeParse: (input: unknown) => unknown }, input: object) =>
  refusals(schema, input).map((refusal) => refusal.split(':')[0]);

describe('batchSchema', () => {
  it('takes a batch as its label says, in one form, and drops unknown fields', () => {
    expect(
      batchSchema.parse({ ...batch, note: '  First delivery ', quantity: 120, id: 'x' }),
    ).toEqual({
      batchNumber: 'AB2611',
      manufacturedOn: day('2026-10-01'),
      expiresOn: day('2028-09-30'),
      quantity: 120,
      note: 'First delivery',
    });
    expect(batchSchema.parse({ ...batch, batchNumber: 'b-26/11.a' }).batchNumber).toBe(
      'B-26/11.A',
    );
  });

  it('wants a batch number of letters, digits, "/", "." and "-"', () => {
    for (const batchNumber of ['', '   ', 'AB_2611', '-AB', 'A'.repeat(41)]) {
      expect([batchNumber, fields(batchSchema, { ...batch, batchNumber })]).toEqual([
        batchNumber,
        ['batchNumber'],
      ]);
    }
    expect(fields(batchSchema, { ...batch, batchNumber: 'A'.repeat(40) })).toEqual([]);
  });

  it('wants real dates in the form 2026-10-31', () => {
    for (const date of ['31-10-2026', '2026-1-5', '2026-02-29', '2026-10-31T00:00:00Z', '']) {
      expect([date, refusals(batchSchema, { ...batch, expiresOn: date })]).toEqual([
        date,
        ['expiresOn: Use a date like 2026-10-31'],
      ]);
    }
    expect(fields(batchSchema, { ...batch, manufacturedOn: '2028-02-29' })).toEqual([]);
  });

  it('wants from 1 to 1,000,000 whole packs, and a note of at most 200 characters', () => {
    for (const quantity of [0, -1, 1.5, 1_000_001]) {
      expect([quantity, fields(batchSchema, { ...batch, quantity })]).toEqual([
        quantity,
        ['quantity'],
      ]);
    }
    expect(fields(batchSchema, { ...batch, quantity: 1_000_000 })).toEqual([]);
    expect(fields(batchSchema, { ...batch, note: 'n'.repeat(201) })).toEqual(['note']);
    expect(batchSchema.parse({ ...batch, note: '   ' }).note).toBeNull();
  });
});

describe('batchUpdateSchema', () => {
  it('takes only the details that change, never the quantity', () => {
    expect(
      batchUpdateSchema.parse({ expiresOn: '2028-10-31', quantity: 5 }),
    ).toEqual({ expiresOn: day('2028-10-31') });
  });

  it('refuses a change with nothing in it', () => {
    expect(refusals(batchUpdateSchema, {})).toEqual([': Nothing to change']);
    expect(refusals(batchUpdateSchema, { quantity: 5 })).toEqual([': Nothing to change']);
  });
});

describe('movementSchema', () => {
  it('takes a delivery, a write-off, and a correction that says why', () => {
    expect(movementSchema.parse({ change: 24, reason: 'RECEIVED' })).toEqual({
      change: 24,
      reason: 'RECEIVED',
    });
    expect(movementSchema.parse({ change: -2, reason: 'DAMAGED', note: ' Broken seal ' })).toEqual({
      change: -2,
      reason: 'DAMAGED',
      note: 'Broken seal',
    });
    expect(movementSchema.parse({ change: -5, reason: 'EXPIRED' }).change).toBe(-5);
    expect(
      movementSchema.parse({ change: 3, reason: 'CORRECTION', note: 'Count on 6 Nov' }).change,
    ).toBe(3);
  });

  it('wants a delivery to add and a write-off to remove', () => {
    expect(refusals(movementSchema, { change: -24, reason: 'RECEIVED' })).toEqual([
      'change: A delivery adds stock: use a positive number',
    ]);
    for (const reason of ['DAMAGED', 'EXPIRED']) {
      expect(refusals(movementSchema, { change: 2, reason })).toEqual([
        'change: A write-off removes stock: use a negative number',
      ]);
    }
  });

  it('wants a note for a correction', () => {
    for (const note of [undefined, null, '   ']) {
      expect(refusals(movementSchema, { change: -1, reason: 'CORRECTION', note })).toEqual([
        'note: Say why the count differs',
      ]);
    }
  });

  it('gives one error for one wrong field', () => {
    expect(refusals(movementSchema, { change: 0, reason: 'RECEIVED' })).toEqual([
      'change: A change of 0 changes nothing',
    ]);
    expect(fields(movementSchema, { change: 1.5, reason: 'CORRECTION', note: 'x' })).toEqual([
      'change',
    ]);
    expect(fields(movementSchema, { change: 1_000_001, reason: 'RECEIVED' })).toEqual(['change']);
    expect(refusals(movementSchema, { change: -1, reason: 'SOLD' })).toEqual([
      'reason: Choose RECEIVED, DAMAGED, EXPIRED or CORRECTION',
    ]);
  });
});

describe('movementListQuerySchema', () => {
  it('pages by 50 by default, at most 100, and continues before a movement', () => {
    expect(movementListQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      movementListQuerySchema.parse({ limit: '100', before: '6c5b4a39-2817-4f06-b5e4-d3c2b1a09f8e', other: 'x' }),
    ).toEqual({ limit: 100, before: '6c5b4a39-2817-4f06-b5e4-d3c2b1a09f8e' });
    for (const query of [{ limit: '0' }, { limit: '101' }, { limit: 'many' }, { before: 'last' }]) {
      expect([query, movementListQuerySchema.safeParse(query).success]).toEqual([query, false]);
    }
  });
});
