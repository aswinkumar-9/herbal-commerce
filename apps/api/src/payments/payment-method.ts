import type { PaymentMethod } from '../generated/prisma/enums';

// Razorpay's names for the ways it takes, as its payments carry them.
const RAZORPAY_METHODS = new Map<string, PaymentMethod>([
  ['upi', 'UPI'],
  ['card', 'CARD'],
  ['netbanking', 'NETBANKING'],
  ['wallet', 'WALLET'],
  ['emi', 'EMI'],
  ['cardless_emi', 'EMI'],
  ['paylater', 'PAY_LATER'],
]);

// How a customer paid, for reports (part 15C, ADR 0046). Any other way
// Razorpay takes, or none named, is OTHER.
export function paymentMethodOf(razorpayMethod: string | null): PaymentMethod {
  return RAZORPAY_METHODS.get(razorpayMethod ?? '') ?? 'OTHER';
}
