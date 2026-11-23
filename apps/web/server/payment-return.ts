// Razorpay's answer, as its payment page sends the customer back (part 14C,
// ADR 0042). It is a form from another site: the customer's cookie stays
// behind (SameSite=Lax), and the check every other form passes would refuse
// it (ADR 0041). So this one route takes it before that check, changes
// nothing, and sends the customer on to a page of the website with what
// Razorpay said: GET /orders/:id/payment, where the customer's own session
// asks the API to confirm it (routes/order-payment.tsx). Anything but a
// payment's ID and signature is a payment that did not go through.
import express from 'express';
import type { Request, RequestHandler } from 'express';
import { RAZORPAY_PAYMENT_ID, RAZORPAY_SIGNATURE } from '../app/razorpay.ts';

// An order's ID: a UUID.
const ORDER_ID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

// Razorpay's form is small: three fields, or a few about an error.
const MOST_BYTES = 16 * 1024;

export const RAZORPAY_RETURN_PATH = '/orders/:id/payment';

export const paymentReturn: RequestHandler[] = [
  // Read as it came, whatever its type; fieldsOf() reads both kinds of form.
  express.raw({ type: () => true, limit: MOST_BYTES }),
  async (request, response) => {
    response.set('Cache-Control', 'no-store');
    const id = request.params['id'];
    if (typeof id !== 'string' || !ORDER_ID.test(id)) {
      response.status(404).type('text/plain').send('Not found');
      return;
    }
    const fields = await fieldsOf(request);
    const paymentId = fields?.get('razorpay_payment_id');
    const signature = fields?.get('razorpay_signature');
    if (
      typeof paymentId === 'string' &&
      RAZORPAY_PAYMENT_ID.test(paymentId) &&
      typeof signature === 'string' &&
      RAZORPAY_SIGNATURE.test(signature)
    ) {
      const said = new URLSearchParams({ payment: paymentId, signature });
      response.redirect(303, `/orders/${id}/payment?${said.toString()}`);
      return;
    }
    response.redirect(303, `/orders/${id}?payment=failed`);
  },
];

// The form's fields, sent URL-encoded or as multipart form data: the
// platform reads both. Anything else, or nothing, is no form.
async function fieldsOf(request: Request): Promise<FormData | null> {
  const body: unknown = request.body;
  const type = request.get('content-type');
  if (!Buffer.isBuffer(body) || !type) {
    return null;
  }
  try {
    return await new Response(new Uint8Array(body), {
      headers: { 'content-type': type },
    }).formData();
  } catch {
    return null;
  }
}
