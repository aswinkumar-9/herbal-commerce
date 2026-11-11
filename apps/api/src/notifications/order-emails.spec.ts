import {
  orderCancelled,
  orderDelivered,
  orderPacked,
  orderPaid,
  orderShipped,
  refundFailed,
  refundProcessed,
  rupees,
  type PaidOrder,
} from './order-emails';

const REFUND_ID = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f101';

const order: PaidOrder = {
  reference: '7KQ2M9XDPA',
  items: [
    {
      productName: 'Ashwagandha Capsules',
      quantity: 60,
      unit: 'CAPSULES',
      packs: 2,
      lineTotalRupees: 898,
    },
    {
      productName: 'Tulsi Tea',
      quantity: 1,
      unit: 'PIECES',
      packs: 1,
      lineTotalRupees: 449,
    },
  ],
  itemsTotalRupees: 1_347,
  itemsGstRupees: 64,
  deliveryChargeRupees: 49,
  totalRupees: 1_396,
  deliveryName: 'Asha K',
  deliveryLine1: '12, 3rd Cross, Indiranagar',
  deliveryLine2: 'Near the temple',
  deliveryCity: 'Bengaluru',
  deliveryState: 'Karnataka',
  deliveryPincode: '560038',
};

describe('the order emails', () => {
  it('writes rupees the Indian way', () => {
    expect(rupees(0)).toBe('Rs 0');
    expect(rupees(898)).toBe('Rs 898');
    expect(rupees(1_396)).toBe('Rs 1,396');
    expect(rupees(129_999)).toBe('Rs 1,29,999');
  });

  it('confirms a paid order with everything in it, as a record to keep', () => {
    const email = orderPaid('Asha K', order);

    expect(email.subject).toBe('Your order 7KQ2M9XDPA is confirmed');
    expect(email.text).toBe(
      [
        'Hello Asha K,',
        'Thank you for your order. We have received your payment for order 7KQ2M9XDPA.',
        'Ashwagandha Capsules: 2 packs of 60 capsules, Rs 898\nTulsi Tea: 1 pack of 1 piece, Rs 449',
        'Items: Rs 1,347 (GST included: Rs 64)\nDelivery: Rs 49\nTotal paid: Rs 1,396',
        'Delivering to:\nAsha K\n12, 3rd Cross, Indiranagar\nNear the temple\nBengaluru, Karnataka 560038',
        'We will email you again when your order is packed, and when it ships with its tracking number.',
      ].join('\n\n'),
    );
    expect(email.html).toContain(
      '<p>Items: Rs 1,347 (GST included: Rs 64)<br>Delivery: Rs 49<br>Total paid: Rs 1,396</p>',
    );
  });

  it('says free delivery, and leaves out an empty second address line', () => {
    const email = orderPaid('Asha K', {
      ...order,
      deliveryChargeRupees: 0,
      totalRupees: 1_347,
      deliveryLine2: null,
    });

    expect(email.text).toContain('Delivery: free\nTotal paid: Rs 1,347');
    expect(email.text).toContain(
      'Delivering to:\nAsha K\n12, 3rd Cross, Indiranagar\nBengaluru, Karnataka 560038',
    );
  });

  it('names every pack size in words', () => {
    const units = [
      [100, 'G', '100 g'],
      [1, 'KG', '1 kg'],
      [200, 'ML', '200 ml'],
      [1, 'L', '1 L'],
      [1, 'CAPSULES', '1 capsule'],
      [30, 'TABLETS', '30 tablets'],
      [1, 'TABLETS', '1 tablet'],
      [3, 'PIECES', '3 pieces'],
    ] as const;
    for (const [quantity, unit, words] of units) {
      const email = orderPaid('Asha K', {
        ...order,
        items: [{ ...order.items[0], quantity, unit, packs: 1 }],
      });
      expect(email.text).toContain(`Ashwagandha Capsules: 1 pack of ${words},`);
    }
  });

  it('escapes what customers and staff typed, in the HTML only', () => {
    const email = orderPaid('<b>Asha</b>', {
      ...order,
      items: [{ ...order.items[0], productName: 'Tea & <i>Honey</i>' }],
      deliveryLine1: '"12" <Cross>',
    });

    expect(email.html).toContain('<p>Hello &lt;b&gt;Asha&lt;/b&gt;,</p>');
    expect(email.html).toContain('Tea &amp; &lt;i&gt;Honey&lt;/i&gt;');
    expect(email.html).toContain('&quot;12&quot; &lt;Cross&gt;');
    expect(email.html).not.toContain('<b>');
    expect(email.text).toContain('Hello <b>Asha</b>,');
  });

  it('tells of a packed order, and of its delivery', () => {
    expect(orderPacked('Asha K', '7KQ2M9XDPA')).toEqual({
      subject: 'Your order 7KQ2M9XDPA is packed',
      text: 'Hello Asha K,\n\nYour order 7KQ2M9XDPA is packed, and will be handed to the courier soon.\n\nWe will email you its tracking number when it ships.',
      html: '<p>Hello Asha K,</p><p>Your order 7KQ2M9XDPA is packed, and will be handed to the courier soon.</p><p>We will email you its tracking number when it ships.</p>',
    });
    const delivered = orderDelivered('Asha K', '7KQ2M9XDPA');
    expect(delivered.subject).toBe('Your order 7KQ2M9XDPA is delivered');
    expect(delivered.text).toContain(
      'Your order 7KQ2M9XDPA has been marked delivered.',
    );
  });

  it('gives the courier and tracking number when the order ships, and again when staff correct them', () => {
    const shipment = {
      reference: '7KQ2M9XDPA',
      courierName: 'Delhivery',
      trackingNumber: 'EE149081123456',
    };

    const shipped = orderShipped('Asha K', shipment, false);
    expect(shipped.subject).toBe('Your order 7KQ2M9XDPA is on its way');
    expect(shipped.text).toContain(
      'Courier: Delhivery\nTracking number: EE149081123456',
    );

    const corrected = orderShipped('Asha K', shipment, true);
    expect(corrected.subject).toBe(
      'New tracking details for your order 7KQ2M9XDPA',
    );
    expect(corrected.text).toContain(
      'Please use these instead of the ones we sent before.',
    );
    expect(corrected.text).toContain(
      'Courier: Delhivery\nTracking number: EE149081123456',
    );
  });

  it('tells of a cancelled order, and of its payment going back only when it was paid', () => {
    const unpaid = orderCancelled('Asha K', '7KQ2M9XDPA', null);
    expect(unpaid.subject).toBe('Your order 7KQ2M9XDPA is cancelled');
    expect(unpaid.text).toBe(
      'Hello Asha K,\n\nYour order 7KQ2M9XDPA has been cancelled.',
    );

    const paid = orderCancelled('Asha K', '7KQ2M9XDPA', 1_396);
    expect(paid.text).toContain(
      'Your payment of Rs 1,396 is going back to you in full, to the account or card you paid with. We will email you again when it is back.',
    );
  });

  it('tells the customer a refund is back, and why it was given', () => {
    const reasons = [
      ['ORDER_EXPIRED', 'its items were no longer in stock'],
      ['ORDER_CANCELLED', 'for an order that had been cancelled'],
      ['ALREADY_PAID', 'a second payment'],
      ['CANCELLED_BY_CUSTOMER', 'cancelled before it shipped'],
      ['CANCELLED_BY_STAFF', 'cancelled before it shipped'],
    ] as const;
    for (const [reason, words] of reasons) {
      const email = refundProcessed('Asha K', '7KQ2M9XDPA', 498, reason);
      expect(email.subject).toBe(
        'Your refund for order 7KQ2M9XDPA is complete',
      );
      expect(email.text).toContain(
        'We have sent Rs 498 for order 7KQ2M9XDPA back to the account or card you paid with.',
      );
      expect(email.text).toContain(words);
    }
  });

  it('asks the Super Users to give a failed refund back by hand, with no customer details', () => {
    const email = refundFailed('7KQ2M9XDPA', REFUND_ID, 498, 'ALREADY_PAID');

    expect(email.subject).toBe(
      'Action needed: a refund for order 7KQ2M9XDPA failed',
    );
    expect(email.text).toContain(
      'Razorpay could not give back Rs 498 for order 7KQ2M9XDPA.',
    );
    expect(email.text).toContain(`Refund: ${REFUND_ID}\nReason: ALREADY_PAID.`);
    expect(email.text).toContain('GET /v1/staff/refunds?status=FAILED');
    expect(email.text).not.toContain('Hello');
  });

  it('has no link in any email', () => {
    const shipment = {
      reference: '7KQ2M9XDPA',
      courierName: 'Delhivery',
      trackingNumber: 'EE149081123456',
    };
    const emails = [
      orderPaid('Asha K', order),
      orderPacked('Asha K', '7KQ2M9XDPA'),
      orderShipped('Asha K', shipment, false),
      orderShipped('Asha K', shipment, true),
      orderDelivered('Asha K', '7KQ2M9XDPA'),
      orderCancelled('Asha K', '7KQ2M9XDPA', 498),
      refundProcessed('Asha K', '7KQ2M9XDPA', 498, 'ORDER_EXPIRED'),
      refundFailed('7KQ2M9XDPA', REFUND_ID, 498, 'ORDER_EXPIRED'),
    ];
    for (const email of emails) {
      expect(email.text).not.toMatch(/https?:/);
      expect(email.html).not.toContain('href');
    }
  });
});
