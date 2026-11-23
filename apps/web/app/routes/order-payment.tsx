import { redirect } from 'react-router';
import { segment } from '../api.server.ts';
import { keepOutOfCaches } from '../no-store.server.ts';
import { UUID, confirmPayment } from '../orders.server.ts';
import { RAZORPAY_PAYMENT_ID, RAZORPAY_SIGNATURE } from '../razorpay.ts';
import type { Route } from './+types/order-payment';

// Back from Razorpay's payment page (part 14C, ADR 0042), by way of the
// website's server (server/payment-return.ts): with the customer's own
// session, the API is asked to confirm what Razorpay said, then the
// order's page shows where the order stands. No page of its own: every way
// out is the order's page, which says what happened when it isn't plain
// from the order. A visitor signs in first, and comes back here.
// The address holds the payment's signature: no cache keeps it.
export const middleware: Route.MiddlewareFunction[] = [keepOutOfCaches];

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const order = `/orders/${segment(params.id)}`;
  // An address no order could have: its page says "not found".
  if (!UUID.test(params.id)) {
    throw redirect(order);
  }
  const said = new URL(request.url).searchParams;
  const paymentId = said.get('payment') ?? '';
  const signature = said.get('signature') ?? '';
  if (
    !RAZORPAY_PAYMENT_ID.test(paymentId) ||
    !RAZORPAY_SIGNATURE.test(signature)
  ) {
    throw redirect(`${order}?payment=failed`);
  }
  const confirmed = await confirmPayment(request, context, params.id, {
    paymentId,
    signature,
  });
  if (confirmed.ok) {
    // Paid, or with its money on the way back: the order says so. Still
    // waiting: Razorpay hasn't captured it yet, or it failed.
    throw redirect(
      confirmed.data.status === 'PENDING_PAYMENT'
        ? `${order}?payment=checking`
        : order,
    );
  }
  if (confirmed.status === 404) {
    throw redirect(order);
  }
  // A wrong signature, or a payment for another order.
  if (confirmed.status === 400 || confirmed.status === 409) {
    throw redirect(`${order}?payment=unverified`);
  }
  // Razorpay or the API can't be asked now. Razorpay tells the API itself
  // too, so the order's page shows the payment once it has.
  throw redirect(`${order}?payment=checking`);
}
