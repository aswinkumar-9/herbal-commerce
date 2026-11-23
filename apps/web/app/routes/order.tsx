import { data } from 'react-router';
import { dataOrUnavailable } from '../account.server.ts';
import { phoneShown } from '../address.ts';
import { getConfig } from '../config.server.ts';
import { OrderSummary } from '../components/OrderSummary.tsx';
import { UUID, readOrder, timeInIndia } from '../orders.server.ts';
import { pageTitle } from '../page-title.ts';
import { pageMeta } from '../seo.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/order';

// One of the customer's orders (part 14C, ADR 0042): its reference, where it
// stands, what was ordered at what price, and where it goes. Only its own
// customer sees it; anyone else's is "not found", like one that doesn't
// exist. Paying comes next (step 3); its history and cancelling in 14D.
const words = text.order;

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
  return {
    order,
    holdUntil: timeInIndia(order.holdExpiresAt),
    origin: getConfig().origin,
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
  const { order, holdUntil } = loaderData;
  const { delivery } = order;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 pt-32 pb-24">
      <header className="flex flex-col gap-2">
        <h1 className="heading-4 text-balance text-ink md:heading-3">
          {words.title(order.reference)}
        </h1>
        <p className="body-6 text-ink-muted">{words.reference}</p>
      </header>
      <p className="body-4 rounded-3xl bg-primary-soft p-6 text-ink">
        {order.status === 'PENDING_PAYMENT'
          ? words.status.PENDING_PAYMENT(holdUntil)
          : words.status[order.status]}
      </p>
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
