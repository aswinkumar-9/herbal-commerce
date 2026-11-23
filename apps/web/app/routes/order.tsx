import { CheckCircle, Circle, Copy, XCircle } from '@phosphor-icons/react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Ref } from 'react';
import { Form, Link, data, redirect, useNavigation } from 'react-router';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import {
  askAsCustomer,
  dataOrUnavailable,
  meSchema,
} from '../account.server.ts';
import { phoneShown } from '../address.ts';
import { getConfig } from '../config.server.ts';
import { FormAlert, TEXT_LINK } from '../components/FormPage.tsx';
import { OrderSummary } from '../components/OrderSummary.tsx';
import {
  DANGER_PILL,
  GOLD_PILL_LARGE,
  OUTLINE_PILL,
} from '../components/pills.ts';
import { given, tooMany } from '../form-checks.server.ts';
import {
  API_HOLD_OVER,
  CANCELLABLE,
  UUID,
  cancelOrder,
  historyOf,
  readOrder,
  startPayment,
  timeInIndia,
} from '../orders.server.ts';
import type { HistoryStep, Order } from '../orders.server.ts';
import { pageTitle } from '../page-title.ts';
import { rupees } from '../price.ts';
import { RAZORPAY_CHECKOUT, checkoutFields } from '../razorpay.ts';
import { pageMeta } from '../seo.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/order';

// One of the customer's orders (part 14C, ADR 0042): its reference, where it
// stands, paying for it on Razorpay's own page while it waits, its history
// with the courier and tracking number once shipped (part 14D), what was
// ordered at what price, where it goes, and any money going back. Only its
// own customer sees it; anyone else's is "not found", like one that doesn't
// exist. Until it ships, it can be cancelled, once asked (part 14D).
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
  const asked = new URL(request.url).searchParams;
  const returned = asked.get('payment');
  return {
    order,
    history: historyOf(order),
    // Not once the time to pay is over: that order is ending by itself.
    canCancel: CANCELLABLE.includes(order.status) && payProblem !== 'over',
    // Just cancelled here.
    done: order.status === 'CANCELLED' && asked.get('done') === 'cancelled',
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

// Cancelling: "Cancel order" asks once more; only "Yes, cancel it" asks the
// API. Then the order's page, saying it is cancelled.
type CancelOutcome = {
  confirming: boolean;
  problem: 'late' | 'resting' | null;
  wait: string | null;
};
const cancelling = (outcome: Partial<CancelOutcome>, status = 200) =>
  data<CancelOutcome>(
    { confirming: false, problem: null, wait: null, ...outcome },
    { status },
  );

export async function action({ request, context, params }: Route.ActionArgs) {
  if (!UUID.test(params.id)) {
    throw data(null, { status: 404 });
  }
  const form = await request.formData();
  switch (given(form, 'intent')) {
    case 'cancel':
      return cancelling({ confirming: true });
    case 'cancelConfirmed': {
      const answer = await cancelOrder(request, context, params.id);
      if (answer.ok) {
        throw redirect(`/orders/${params.id}?done=cancelled`);
      }
      if (answer.status === 404) {
        throw data(null, { status: 404 });
      }
      // Shipped a moment ago, or cancelled or ended already.
      if (answer.status === 409) {
        return cancelling({ problem: 'late' }, 409);
      }
      return answer.status === 429
        ? cancelling(
            { problem: 'resting', wait: tooMany(answer.retryAfter) },
            429,
          )
        : cancelling({ problem: 'resting' }, 503);
    }
    default:
      return cancelling({}, 400);
  }
}

// After cancelling, even refused, the page asks again: React Router
// otherwise keeps what it had after a refusal (4xx), and the page would
// still offer to cancel an order that has just shipped.
export function shouldRevalidate({
  actionStatus,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  return actionStatus === undefined ? defaultShouldRevalidate : true;
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

export default function OrderPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    order,
    history,
    holdUntil,
    pay,
    payProblem,
    payWait,
    returned,
    canCancel,
    done,
  } = loaderData;
  const { delivery } = order;
  const over = payProblem === 'over';
  const outcome: CancelOutcome | undefined = actionData;
  const confirming = (outcome?.confirming ?? false) && canCancel;

  // Back from Razorpay's page, or just cancelled: the keyboard starts at
  // what happened.
  const alert = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    (alert.current ?? status.current)?.focus();
  }, [returned, done]);
  // Asked once more, the keyboard goes to the question; refused, to why.
  const question = useRef<HTMLHeadingElement>(null);
  const refused = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (outcome?.problem) {
      refused.current?.focus();
    } else if (confirming) {
      question.current?.focus();
    }
  }, [outcome, confirming]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-32 pb-24">
      <p className="body-6">
        <Link prefetch="intent" to="/orders" className={TEXT_LINK}>
          {words.allOrders}
        </Link>
      </p>
      <header className="flex flex-col gap-2">
        <h1 className="heading-4 text-balance text-ink md:heading-3">
          {words.title(order.reference)}
        </h1>
        <p className="body-6 text-ink-muted">{words.reference}</p>
      </header>

      {outcome?.problem ? (
        <FormAlert alertRef={refused}>
          <p className="body-4 text-ink">
            {outcome.wait ?? words.cancel.problems[outcome.problem]}
          </p>
        </FormAlert>
      ) : null}
      {confirming ? (
        <CancelQuestion order={order} questionRef={question} />
      ) : null}
      {done ? (
        <output
          ref={status}
          tabIndex={-1}
          className="body-4 block rounded-3xl bg-surface p-6 text-ink outline-none"
        >
          {words.cancel.done}
        </output>
      ) : null}

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
        {/* While asked whether to cancel, paying waits for the answer. */}
        {pay && !confirming ? <PayForm {...pay} /> : null}
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

      <History
        history={history}
        courierName={order.courierName}
        trackingNumber={order.trackingNumber}
      />
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
      {canCancel && !confirming ? <CancelSection order={order} /> : null}
    </div>
  );
}

// Paid and not yet shipped: cancelling gives the payment back in full.
const paidFor = (order: Order): boolean =>
  order.status === 'PAID' || order.status === 'PACKED';

// The way to cancel, at the foot of the page, out of the way of paying.
function CancelSection({ order }: { order: Order }) {
  const said = words.cancel;
  return (
    <section
      aria-labelledby="cancel-heading"
      className="flex flex-col items-start gap-4 rounded-3xl bg-surface p-6"
    >
      <h2 id="cancel-heading" className="title-1 text-ink">
        {said.heading}
      </h2>
      <p className="body-6 text-ink-muted">
        {paidFor(order)
          ? said.intro.paid(rupees(order.totalRupees))
          : said.intro.waiting}
      </p>
      <Form method="post" replace>
        <input type="hidden" name="intent" value="cancel" />
        <button type="submit" className={OUTLINE_PILL}>
          {said.ask}
        </button>
      </Form>
    </section>
  );
}

// Asked once more, at the top of the page: what cancelling does, then
// "Yes, cancel it", or keep the order. Once sent, a second press waits.
function CancelQuestion({
  order,
  questionRef,
}: {
  order: Order;
  questionRef: Ref<HTMLHeadingElement>;
}) {
  const said = words.cancel;
  const navigation = useNavigation();
  const sending =
    navigation.state !== 'idle' &&
    navigation.formData?.get('intent') === 'cancelConfirmed';
  return (
    <section
      aria-labelledby="cancel-title"
      className="flex flex-col gap-6 rounded-3xl bg-surface p-8"
    >
      <h2
        id="cancel-title"
        ref={questionRef}
        tabIndex={-1}
        className="heading-6 text-ink outline-none"
      >
        {said.title(order.reference)}
      </h2>
      <p className="body-3 text-ink">
        {paidFor(order)
          ? said.body.paid(rupees(order.totalRupees))
          : said.body.waiting}
      </p>
      <div className="flex flex-wrap gap-3">
        <Form method="post" replace>
          <input type="hidden" name="intent" value="cancelConfirmed" />
          <button
            type="submit"
            aria-disabled={sending || undefined}
            onClick={(event) => {
              if (sending) {
                event.preventDefault();
              }
            }}
            className={`${DANGER_PILL} aria-disabled:opacity-80`}
          >
            {sending ? `${said.cancelling}…` : said.confirm}
          </button>
        </Form>
        <Link
          prefetch="intent"
          to={`/orders/${order.id}`}
          replace
          className={OUTLINE_PILL}
        >
          {said.keep}
        </Link>
      </div>
    </section>
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

// Its history: each step taken, with when, then those still to come. Once
// shipped, the courier and the tracking number.
function History({
  history,
  courierName,
  trackingNumber,
}: {
  history: readonly HistoryStep[];
  courierName: string | null;
  trackingNumber: string | null;
}) {
  const said = words.history;
  return (
    <section
      aria-labelledby="history-heading"
      className="flex flex-col gap-4 rounded-3xl bg-surface p-6"
    >
      <h2 id="history-heading" className="title-1 text-ink">
        {said.heading}
      </h2>
      <ol className="flex flex-col gap-4">
        {history.map(({ step, done, at, when }) => {
          const ended = step === 'cancelled' || step === 'expired';
          const Mark = ended ? XCircle : done ? CheckCircle : Circle;
          return (
            <li key={step} className="flex gap-3">
              <Mark
                aria-hidden="true"
                weight={done ? 'fill' : 'regular'}
                className={`mt-0.5 size-5 shrink-0 ${done && !ended ? 'text-primary' : 'text-ink-muted'}`}
              />
              <div className="flex min-w-0 flex-col gap-1">
                <p
                  className={done ? 'body-4 text-ink' : 'body-6 text-ink-muted'}
                >
                  {said.steps[step]}
                </p>
                {at && when ? (
                  <time dateTime={at} className="caption-2 text-ink-muted">
                    {when}
                  </time>
                ) : done ? null : (
                  <p className="caption-2 text-ink-muted">{said.notYet}</p>
                )}
                {step === 'shipped' && done ? (
                  <Tracking
                    courierName={courierName}
                    trackingNumber={trackingNumber}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// Copying needs the page's script: false while the server makes the page.
const never = () => () => undefined;

const COPY_BUTTON =
  'button-sm inline-flex items-center justify-center gap-2 rounded-full border border-line-strong px-3 py-2 text-ink transition hover:bg-surface-muted active:scale-98';

// The courier and the tracking number, as staff typed them. The number can
// be copied, where the browser lets the page (with its script); it can
// always be selected.
function Tracking({
  courierName,
  trackingNumber,
}: {
  courierName: string | null;
  trackingNumber: string | null;
}) {
  const said = words.history;
  const canCopy = useSyncExternalStore(
    never,
    () => typeof navigator.clipboard?.writeText === 'function',
    () => false,
  );
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  // "Copied" for a moment, then the button is as it was.
  useEffect(() => {
    if (copied !== 'yes') {
      return;
    }
    const back = setTimeout(() => setCopied(null), 3000);
    return () => clearTimeout(back);
  }, [copied]);
  if (!courierName && !trackingNumber) {
    return null;
  }
  const copy = () => {
    if (trackingNumber) {
      navigator.clipboard.writeText(trackingNumber).then(
        () => setCopied('yes'),
        () => setCopied('no'),
      );
    }
  };
  return (
    <div className="mt-2 flex flex-col">
      <dl className="flex flex-col gap-3">
        {courierName ? (
          <div className="flex flex-col gap-1">
            <dt className="caption-1 text-ink-muted">{said.courier}</dt>
            <dd className="body-5 break-words text-ink">{courierName}</dd>
          </div>
        ) : null}
        {trackingNumber ? (
          <div className="flex flex-col gap-1">
            <dt className="caption-1 text-ink-muted">{said.tracking}</dt>
            <dd className="flex flex-wrap items-center gap-3">
              <span className="body-5 break-all text-ink select-all">
                {trackingNumber}
              </span>
              {canCopy ? (
                <button
                  type="button"
                  onClick={copy}
                  aria-label={
                    copied === 'yes' ? said.copiedFull : said.copyFull
                  }
                  className={COPY_BUTTON}
                >
                  <Copy aria-hidden="true" className="size-4" />
                  {copied === 'yes' ? said.copied : said.copy}
                </button>
              ) : null}
            </dd>
            <dd className="caption-2 text-ink-muted">{said.trackingHint}</dd>
          </div>
        ) : null}
      </dl>
      {/* Always there, so what it says is read out; no space while empty. */}
      <output className="caption-2 mt-3 text-ink empty:mt-0">
        {copied === 'yes'
          ? said.saidCopied
          : copied === 'no'
            ? said.notCopied
            : ''}
      </output>
    </div>
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
