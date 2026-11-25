import { paymentMethodOf } from './payment-method';

describe('paymentMethodOf', () => {
  it('names each way Razorpay takes as reports group it', () => {
    expect(
      [
        'upi',
        'card',
        'netbanking',
        'wallet',
        'emi',
        'cardless_emi',
        'paylater',
      ].map(paymentMethodOf),
    ).toEqual([
      'UPI',
      'CARD',
      'NETBANKING',
      'WALLET',
      'EMI',
      'EMI',
      'PAY_LATER',
    ]);
  });

  it('calls any other way, or none, OTHER', () => {
    const others = ['bank_transfer', 'emandate', 'constructor', '', null];
    for (const method of others) {
      expect(paymentMethodOf(method)).toBe('OTHER');
    }
  });
});
