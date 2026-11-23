import { useEffect, useRef, useState } from 'react';
import { Link, data } from 'react-router';
import {
  askAsCustomer,
  dataOrUnavailable,
  meSchema,
} from '../account.server.ts';
import { phoneShown } from '../address.ts';
import { getConfig } from '../config.server.ts';
import { FormAlert } from '../components/FormPage.tsx';
import { OrderSummary } from '../components/OrderSummary.tsx';
import { GOLD_PILL_LARGE, OUTLINE_PILL } from '../components/pills.ts';
import { tooMany } from '../form-checks.server.ts';
import {
  API_HOLD_OVER,
  UUID,
  readOrder,
  startPayment,
  timeInIndia,
} from '../orders.server.ts';
import type { Order } from '../orders.server.ts';
import { pageTitle } from '../page-title.ts';
import { rupees } from '../price.ts';
import { RAZORPAY_CHECKOUT, checkoutFields } from '../razorpay.ts';
import { pageMeta } from '../seo.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/order';

// One of the customer's orders (part 14C, ADR 0042): its reference, where it
// stands, paying for it on Razorpay's own page while it waits, what was
// ordered at what price, where it goes, and any money going back. Only its
// own customer sees it; anyone else's is "not found", like one that doesn't
// exist. Its history and cancelling come in 14D.
const words = text.order;

type Returned = keyof typeof words.returned;
const isReturned = (value: string | null): value is Returned =>
  value !== null && Object.hasOwn(words.returned, value);

export async function loader({ request, context, params }: Route.LoaderArgs) {
  // An address no order could have is not asked of the API.
  if (!UUID.test(params.id)) {
    throw data(null, { status: 404 });
  }
  const found = await readOrder(request, context, params.id);
  if (!found.ok && found.status === 404) {
    throw data(null, { status: 404 });
  }
  const order = dataOrUnavailable(found);
  const { origin } = getConfig();

  // Waiting for payment: what Razorpay's page needs. The API makes its
  // Razorpay order the first time, and answers the same one after.
  let pay: { totalRupees: number; fields: Record<string, string> } | null =
    null;
  let payProblem: 'over' | 'changed' | 'resting' | null = null;
  let payWait: string | null = null;
  if (order.status === 'PENDING_PAYMENT') {
    const [started, me] = await Promise.all([
      startPayment(request, context, order.id),
      askAsCustomer(request, context, { method: 'GET', path: 'me' }, meSchema),
    ]);
    if (started.ok && me.ok) {
      pay = {
        totalRupees: started.data.totalRupees,
        fields: checkoutFields({
          keyId: started.data.razorpayKeyId,
          razorpayOrderId: started.data.razorpayOrderId,
          totalRupees: started.data.totalRupees,
          shopName: text.shop.name,
          description: words.title(order.reference),
          email: me.data.email,
          phone: order.delivery.phone,
          origin,
          orderId: order.id,
        }),
      };
    } else if (!started.ok && started.status === 404) {
      throw data(null, { status: 404 });
    } else if (!started.ok && started.status === 409) {
      // Over even before the order has expired, or paid or ended a moment
      // ago.
      payProblem = started.message === API_HOLD_OVER ? 'over' : 'changed';
    } else {
      payProblem = 'resting';
      if (!started.ok && started.status === 429) {
        payWait = tooMany(started.retryAfter);
      }
    }
  }
  // Back from Razorpay's page: said only while the order still waits.
  const returned = new URL(request.url).searchParams.get('payment');
  return {
    order,
    holdUntil: timeInIndia(order.holdExpiresAt),
    pay,
    payProblem,
    payWait,
    returned:
      order.status === 'PENDING_PAYMENT' &&
      payProblem !== 'over' &&
      isReturned(returned)
        ? returned
        : null,
    origin,
  };
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData
    ? pageMeta({
        title: pageTitle(words.title(loaderData.order.reference)),
        description: words.description,
        origin: loaderData.origin,
        path: `/orders/${loaderData.order.id}`,
        noindex: true,
      })
    : [];

export default function OrderPage({ loaderData }: Route.ComponentProps) {
  const { order, holdUntil, pay, payProblem, payWait, returned } = loaderData;
  const { delivery } = order;
  const over = payProblem === 'over';

  // Back from Razorpay's page: the keyboard starts at what happened.
  const alert = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    (alert.current ?? status.current)?.focus();
  }, [returned]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-32 pb-24">
      <header className="flex flex-col gap-2">
        <h1 className="heading-4 text-balance text-ink md:heading-3">
          {words.title(order.reference)}
        </h1>
        <p className="body-6 text-ink-muted">{words.reference}</p>
      </header>

      {returned === 'failed' || returned === 'unverified' ? (
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">{words.returned[returned]}</p>
        </FormAlert>
      ) : returned ? (
        <output
          ref={status}
          tabIndex={-1}
          className="body-4 block rounded-3xl bg-surface p-6 text-ink outline-none"
        >
          {words.returned[returned]}
        </output>
      ) : null}

      <div className="flex flex-col items-start gap-4 rounded-3xl bg-primary-soft p-6">
        <p className="body-4 text-ink">
          {order.status !== 'PENDING_PAYMENT'
            ? words.status[order.status]
            : over
              ? words.pay.over
              : words.status.PENDING_PAYMENT(holdUntil)}
        </p>
        {pay ? <PayForm {...pay} /> : null}
        {over ? (
          <Link to="/shop" prefetch="intent" className={OUTLINE_PILL}>
            {words.pay.shop}
          </Link>
        ) : null}
      </div>
      {payProblem === 'changed' || payProblem === 'resting' ? (
        <FormAlert>
          <p className="body-4 text-ink">
            {payWait ?? words.pay.problems[payProblem]}
          </p>
        </FormAlert>
      ) : null}

      <Refunds order={order} />
      <OrderSummary
        headingId="items-heading"
        heading={words.items}
        {...order}
      />
      <section
        aria-labelledby="delivery-heading"
        className="flex flex-col gap-2 rounded-3xl bg-surface p-6"
      >
        <h2 id="delivery-heading" className="title-1 text-ink">
          {words.deliverTo}
        </h2>
        <address className="body-6 break-words text-ink-muted not-italic">
          {delivery.fullName}
          <br />
          {delivery.line1}
          <br />
          {delivery.line2 ? (
            <>
              {delivery.line2}
              <br />
            </>
          ) : null}
          {delivery.city}, {delivery.state} {delivery.pincode}
          <br />
          {text.checkout.address.phone(phoneShown(delivery.phone))}
        </address>
      </section>
    </div>
  );
}

// Paying: a plain form to Razorpay's own page, so it works without the
// page's script too. Once sent, the button says so, and a second press
// waits; back on this page from Razorpay's, it works again.
function PayForm({
  totalRupees,
  fields,
}: {
  totalRupees: number;
  fields: Record<string, string>;
}) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const back = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setLeaving(false);
      }
    };
    window.addEventListener('pageshow', back);
    return () => {
      window.removeEventListener('pageshow', back);
    };
  }, []);
  return (
    <form
      method="post"
      action={RAZORPAY_CHECKOUT}
      onSubmit={(event) => {
        if (leaving) {
          event.preventDefault();
        } else {
          setLeaving(true);
        }
      }}
      className="flex flex-col items-start gap-3"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        aria-disabled={leaving || undefined}
        className={GOLD_PILL_LARGE}
      >
        {leaving ? words.pay.opening : words.pay.button(rupees(totalRupees))}
      </button>
      <p className="caption-2 text-ink-muted">{words.pay.how}</p>
    </form>
  );
}

// Money going back to the customer: why, and where it stands.
function Refunds({ order }: { order: Order }) {
  const refunds = order.payment?.refunds ?? [];
  if (refunds.length === 0) {
    return null;
  }
  const said = words.refunds;
  return (
    <section
      aria-labelledby="refunds-heading"
      className="flex flex-col gap-4 rounded-3xl bg-surface p-6"
    >
      <h2 id="refunds-heading" className="title-1 text-ink">
        {said.heading}
      </h2>
      <ul className="flex flex-col gap-3">
        {refunds.map((refund, index) => {
          const amount = rupees(refund.amountRupees);
          const where =
            refund.status === 'PROCESSED' ||
            (refund.status === 'FAILED' && refund.givenBackAt)
              ? said.back(amount)
              : refund.status === 'FAILED'
                ? said.byHand(amount)
                : said.coming(amount);
          const why = Object.hasOwn(said.reason, refund.reason)
            ? said.reason[refund.reason]
            : null;
          return (
            <li
              key={`${refund.createdAt}-${index}`}
              className="body-6 text-ink"
            >
              {why ? `${why} ` : null}
              {where}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
