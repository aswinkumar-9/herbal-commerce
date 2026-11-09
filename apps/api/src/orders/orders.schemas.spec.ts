import {
  confirmPaymentSchema,
  idempotencyKeySchema,
  orderListQuerySchema,
  placeOrderSchema,
  shipmentCorrectionSchema,
  shipmentSchema,
  staffOrderListQuerySchema,
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

describe('staffOrderListQuerySchema', () => {
  it('pages 50 orders by default, up to 100, the newest first, continuing after an order ID', () => {
    expect(staffOrderListQuerySchema.parse({})).toEqual({
      limit: 50,
      sort: 'newest',
    });
    expect(
      staffOrderListQuerySchema.parse({
        limit: '100',
        after: ADDRESS,
        status: 'PAID',
        sort: 'oldest',
        other: 'dropped',
      }),
    ).toEqual({ limit: 100, after: ADDRESS, status: 'PAID', sort: 'oldest' });
    for (const query of [
      { limit: '101' },
      { limit: '0' },
      { after: 'last' },
      { sort: 'cheapest' },
    ]) {
      expect(
        refusals(staffOrderListQuerySchema, query).map((r) => r.split(':')[0]),
      ).toEqual(Object.keys(query));
    }
  });

  it('takes every order status, and refuses anything else, saying what to send', () => {
    for (const status of [
      'PENDING_PAYMENT',
      'PAID',
      'PACKED',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
      'EXPIRED',
    ]) {
      expect(staffOrderListQuerySchema.parse({ status }).status).toBe(status);
    }
    for (const status of ['paid', 'REFUNDED', '']) {
      expect(refusals(staffOrderListQuerySchema, { status })).toEqual([
        'status: Use an order status, such as PAID or PACKED',
      ]);
    }
  });

  it('takes a reference as a customer quotes it, in capitals and without spaces around', () => {
    expect(
      staffOrderListQuerySchema.parse({ reference: ' 7kq2m9xdpa ' }).reference,
    ).toBe('7KQ2M9XDPA');
    for (const reference of [
      '7KQ2M9XDP',
      '7KQ2M9XDPAB',
      '7KQ2M9XDP0',
      '7KQ 2M9XDP',
    ]) {
      expect(refusals(staffOrderListQuerySchema, { reference })).toEqual([
        'reference: An order reference has 10 letters and digits',
      ]);
    }
  });
});

describe('shipmentSchema', () => {
  it('takes the courier and the tracking number as staff type them, cleaned', () => {
    expect(
      shipmentSchema.parse({
        courierName: '  Blue   Dart ',
        trackingNumber: ' ee 1234 5678 9in ',
        other: 'dropped',
      }),
    ).toEqual({ courierName: 'Blue Dart', trackingNumber: 'EE123456789IN' });
    expect(
      shipmentSchema.parse({
        courierName: 'DL',
        trackingNumber: '1490-8112',
      }),
    ).toEqual({ courierName: 'DL', trackingNumber: '1490-8112' });
  });

  it('takes a courier of 60 characters and a tracking number of 40, and nothing longer', () => {
    expect(
      shipmentSchema.parse({
        courierName: 'D'.repeat(60),
        trackingNumber: 'A'.repeat(40),
      }),
    ).toEqual({ courierName: 'D'.repeat(60), trackingNumber: 'A'.repeat(40) });
    expect(
      refusals(shipmentSchema, {
        courierName: 'D'.repeat(61),
        trackingNumber: 'A'.repeat(41),
      }),
    ).toEqual([
      'courierName: Name the courier in 2 to 60 characters',
      'trackingNumber: A tracking number has 4 to 40 letters, digits or hyphens',
    ]);
  });

  it('refuses a courier too short, and a tracking number too short or with other characters', () => {
    for (const courierName of ['', ' D ']) {
      expect(
        refusals(shipmentSchema, { courierName, trackingNumber: 'EE1234' }),
      ).toEqual(['courierName: Name the courier in 2 to 60 characters']);
    }
    for (const trackingNumber of ['AB1', '-AB1234', 'EE/12345', '']) {
      expect(
        refusals(shipmentSchema, { courierName: 'Delhivery', trackingNumber }),
      ).toEqual([
        'trackingNumber: A tracking number has 4 to 40 letters, digits or hyphens',
      ]);
    }
    expect(
      refusals(shipmentSchema, {}).map((refusal) => refusal.split(':')[0]),
    ).toEqual(['courierName', 'trackingNumber']);
  });
});

describe('shipmentCorrectionSchema', () => {
  it('takes the courier, the tracking number, or both, cleaned the same way', () => {
    expect(
      shipmentCorrectionSchema.parse({ courierName: ' Blue  Dart' }),
    ).toEqual({ courierName: 'Blue Dart' });
    expect(
      shipmentCorrectionSchema.parse({ trackingNumber: 'ee 123456789in' }),
    ).toEqual({ trackingNumber: 'EE123456789IN' });
    expect(
      refusals(shipmentCorrectionSchema, { trackingNumber: 'AB1' }),
    ).toEqual([
      'trackingNumber: A tracking number has 4 to 40 letters, digits or hyphens',
    ]);
  });

  it('refuses nothing to change', () => {
    expect(refusals(shipmentCorrectionSchema, {})).toEqual([
      ': Nothing to change',
    ]);
    expect(refusals(shipmentCorrectionSchema, { other: 'x' })).toEqual([
      ': Nothing to change',
    ]);
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
