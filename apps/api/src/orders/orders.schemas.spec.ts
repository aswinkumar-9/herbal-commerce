import {
  idempotencyKeySchema,
  orderListQuerySchema,
  placeOrderSchema,
} from './orders.schemas';

const ADDRESS = '6f2b9d1e-4c7a-4e3b-9a85-1d2c3e4f5a6b';

// The errors an invalid input gets, as "field: message".
function refusals(
  schema: { safeParse: (input: unknown) => unknown },
  input: unknown,
): string[] {
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

describe('placeOrderSchema', () => {
  it('takes an address and the total the customer saw, and drops unknown fields', () => {
    expect(
      placeOrderSchema.parse({
        addressId: ADDRESS,
        totalPaise: 214_600,
        status: 'PAID',
        userId: ADDRESS,
      }),
    ).toEqual({ addressId: ADDRESS, totalPaise: 214_600 });
  });

  it('refuses an address that is not an ID, and a total that is not whole paise', () => {
    expect(
      refusals(placeOrderSchema, { addressId: 'home', totalPaise: 100 }),
    ).toEqual(['addressId: Choose one of your delivery addresses']);
    for (const totalPaise of [0, 99.5, '214600', null, undefined]) {
      expect(
        refusals(placeOrderSchema, { addressId: ADDRESS, totalPaise }).map(
          (refusal) => refusal.split(':')[0],
        ),
      ).toEqual(['totalPaise']);
    }
  });
});

describe('idempotencyKeySchema', () => {
  it('takes a UUID and refuses anything else, saying what to send', () => {
    expect(idempotencyKeySchema.parse(ADDRESS)).toBe(ADDRESS);
    for (const key of [undefined, '', 'order-1', 'x'.repeat(36)]) {
      expect(refusals(idempotencyKeySchema, key)).toEqual([
        ': Send an Idempotency-Key header: a new UUID for each order',
      ]);
    }
  });
});

describe('orderListQuerySchema', () => {
  it('pages 20 orders by default, up to 50, continuing before an order ID', () => {
    expect(orderListQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(
      orderListQuerySchema.parse({ limit: '50', before: ADDRESS }),
    ).toEqual({ limit: 50, before: ADDRESS });
    expect(
      refusals(orderListQuerySchema, { limit: '51' }).map(
        (r) => r.split(':')[0],
      ),
    ).toEqual(['limit']);
    expect(
      refusals(orderListQuerySchema, { limit: '0' }).map(
        (r) => r.split(':')[0],
      ),
    ).toEqual(['limit']);
    expect(
      refusals(orderListQuerySchema, { before: 'last' }).map(
        (r) => r.split(':')[0],
      ),
    ).toEqual(['before']);
  });
});
