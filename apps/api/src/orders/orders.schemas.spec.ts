import {
  confirmPaymentSchema,
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
        totalRupees: 2_146,
        status: 'PAID',
        userId: ADDRESS,
      }),
    ).toEqual({ addressId: ADDRESS, totalRupees: 2_146 });
  });

  it('refuses an address that is not an ID, and a total that is not whole rupees', () => {
    expect(
      refusals(placeOrderSchema, { addressId: 'home', totalRupees: 100 }),
    ).toEqual(['addressId: Choose one of your delivery addresses']);
    for (const totalRupees of [0, 99.5, '2146', null, undefined]) {
      expect(
        refusals(placeOrderSchema, { addressId: ADDRESS, totalRupees }).map(
          (refusal) => refusal.split(':')[0],
        ),
      ).toEqual(['totalRupees']);
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

describe('confirmPaymentSchema', () => {
  const SIGNATURE =
    '2fe297ba8d4585a8ecb4e852d6603baf5e5aac841d17c54584d715a588538d9a';

  it("takes the payment ID and the signature from Razorpay's page, and drops the rest", () => {
    expect(
      confirmPaymentSchema.parse({
        razorpayPaymentId: 'pay_G3P9vcIhRs3NV4',
        razorpaySignature: SIGNATURE.toUpperCase(),
        razorpayOrderId: 'order_FromTheApp01',
      }),
    ).toEqual({
      razorpayPaymentId: 'pay_G3P9vcIhRs3NV4',
      razorpaySignature: SIGNATURE.toUpperCase(),
    });
  });

  it('refuses a payment ID or a signature in another form', () => {
    for (const razorpayPaymentId of [
      'pay_',
      'order_RB58MiP5SPFYyM',
      'pay_a/b',
      ' pay_G3P9',
    ]) {
      expect(
        refusals(confirmPaymentSchema, {
          razorpayPaymentId,
          razorpaySignature: SIGNATURE,
        }),
      ).toEqual([
        "razorpayPaymentId: Send the razorpay_payment_id from Razorpay's payment page",
      ]);
    }
    for (const razorpaySignature of [
      SIGNATURE.slice(1),
      `${SIGNATURE}0`,
      'z'.repeat(64),
    ]) {
      expect(
        refusals(confirmPaymentSchema, {
          razorpayPaymentId: 'pay_G3P9vcIhRs3NV4',
          razorpaySignature,
        }),
      ).toEqual([
        "razorpaySignature: Send the razorpay_signature from Razorpay's payment page",
      ]);
    }
    expect(
      refusals(confirmPaymentSchema, {}).map(
        (refusal) => refusal.split(':')[0],
      ),
    ).toEqual(['razorpayPaymentId', 'razorpaySignature']);
  });
});
