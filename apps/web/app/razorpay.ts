// Razorpay's own payment page (part 14C, ADR 0042). The order's page sends
// a plain form there; Razorpay sends the customer back with a form of its
// own (server/payment-return.ts). No Razorpay script runs on the website.
export const RAZORPAY_ORIGIN = 'https://api.razorpay.com';
export const RAZORPAY_CHECKOUT = `${RAZORPAY_ORIGIN}/v1/checkout/embedded`;

// As the API checks them (apps/api/src/payments/razorpay.gateway.ts and
// config/env.ts; a test compares them).
export const RAZORPAY_KEY_ID = /^rzp_(test|live)_[A-Za-z0-9]{8,}$/;
export const RAZORPAY_ORDER_ID = /^order_[A-Za-z0-9]{1,40}$/;
export const RAZORPAY_PAYMENT_ID = /^pay_[A-Za-z0-9]{1,40}$/;
// Razorpay's signature: a SHA-256 HMAC, in hex.
export const RAZORPAY_SIGNATURE = /^[0-9a-fA-F]{64}$/;

// The form Razorpay's page takes (its "Hosted Checkout"): the Razorpay
// order the API made, its amount in paise (the API counts whole rupees
// only), the shop's name, the customer's email and phone, which Razorpay
// asks for, and where to send the customer back. Nothing else about the
// customer goes to Razorpay.
export function checkoutFields({
  keyId,
  razorpayOrderId,
  totalRupees,
  shopName,
  description,
  email,
  phone,
  origin,
  orderId,
}: {
  keyId: string;
  razorpayOrderId: string;
  totalRupees: number;
  shopName: string;
  description: string;
  email: string;
  phone: string;
  origin: string;
  orderId: string;
}): Record<string, string> {
  return {
    key_id: keyId,
    order_id: razorpayOrderId,
    amount: String(totalRupees * 100),
    currency: 'INR',
    name: shopName,
    description,
    'prefill[email]': email,
    // An Indian mobile number, with its country code.
    'prefill[contact]': /^\d{10}$/.test(phone) ? `+91${phone}` : phone,
    callback_url: `${origin}/orders/${orderId}/payment`,
    cancel_url: `${origin}/orders/${orderId}?payment=cancelled`,
  };
}
