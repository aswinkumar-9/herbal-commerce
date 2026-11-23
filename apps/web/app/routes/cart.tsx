import { Leaf } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { Form, Link, data, useNavigation } from 'react-router';
import {
  API_OUT_OF_STOCK,
  isSku,
  packsFrom,
  readCart,
  removeLine,
  setPacks,
} from '../cart.server.ts';
import type { CartLine } from '../cart.server.ts';
import { getConfig } from '../config.server.ts';
import { BusyButton } from '../components/BusyButton.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { FormAlert } from '../components/FormPage.tsx';
import { GOLD_PILL, OUTLINE_PILL } from '../components/pills.ts';
import { given } from '../form-checks.server.ts';
import { pageTitle } from '../page-title.ts';
import { MOST_PACKS, packName } from '../packs.ts';
import { rupees } from '../price.ts';
import { pageMeta } from '../seo.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/cart';

// The customer's cart (part 14C, ADR 0042): each line at today's price,
// its packs changed one at a time or taken out, and what the lines that
// can be bought come to. Only for a signed-in customer; anyone else signs
// in first. Delivery and the order's total come at checkout.
const words = text.cart;

export async function loader({ request, context }: Route.LoaderArgs) {
  return {
    cart: await readCart(request, context),
    origin: getConfig().origin,
  };
}

type Problem = keyof typeof words.problems;
// What came of a change: the line it was about, and what was done or why
// not. One shape for every answer.
type Outcome = {
  sku: string | null;
  // The line, by name, as it is read out: it may be gone by then.
  name: string | null;
  done: 'packs' | 'removed' | null;
  packs: number | null;
  problem: Problem | null;
};

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const sku = given(form, 'sku');
  if (!isSku(sku)) {
    return answer({ problem: 'gone' }, 400);
  }
  if (given(form, 'intent') === 'remove') {
    // Its name first, to say what was taken out.
    const before = await readCart(request, context);
    const line = before.items.find((found) => found.sku === sku);
    const removed = await removeLine(request, context, sku);
    return removed.ok
      ? answer(
          { sku, name: line ? lineName(line) : null, done: 'removed' },
          200,
        )
      : answer({ sku, problem: 'resting' }, 503);
  }
  // One pack more or fewer: the line's packs, set to that.
  const packs = packsFrom(form.get('packs'));
  if (given(form, 'intent') !== 'packs' || packs === null) {
    return answer({ sku, problem: 'full' }, 400);
  }
  const changed = await setPacks(request, context, sku, packs);
  if (changed.ok) {
    const line = changed.data.items.find((found) => found.sku === sku);
    return answer(
      { sku, name: line ? lineName(line) : null, done: 'packs', packs },
      200,
    );
  }
  if (changed.status === 404) {
    return answer({ sku, problem: 'gone' }, 404);
  }
  if (changed.status === 409 || changed.status === 400) {
    return answer(
      {
        sku,
        problem: changed.message === API_OUT_OF_STOCK ? 'stock' : 'full',
      },
      409,
    );
  }
  return answer({ sku, problem: 'resting' }, 503);
}

function answer(said: Partial<Outcome>, status: number) {
  return data<Outcome>(
    {
      sku: said.sku ?? null,
      name: said.name ?? null,
      done: said.done ?? null,
      packs: said.packs ?? null,
      problem: said.problem ?? null,
    },
    { status },
  );
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  loaderData
    ? pageMeta({
        title: pageTitle(words.title),
        description: words.description,
        origin: loaderData.origin,
        path: '/cart',
        noindex: true,
      })
    : [];

// A line as it is read out: its product and its pack size.
const lineName = (line: CartLine): string =>
  `${line.product.name}, ${packName(line)}`;

export default function CartPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { cart } = loaderData;
  const outcome: Outcome | undefined = actionData;
  const navigation = useNavigation();
  const sending =
    navigation.state !== 'idle' && navigation.formMethod === 'POST'
      ? navigation.formData
      : undefined;

  // The keyboard goes to what came of a change: what was done, or why not.
  const status = useRef<HTMLOutputElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (outcome?.problem) {
      alert.current?.focus();
    } else if (outcome?.done) {
      status.current?.focus();
    }
  }, [outcome]);

  const said =
    outcome?.name && outcome.done === 'removed'
      ? words.saved.removed(outcome.name)
      : outcome?.name && outcome.done === 'packs' && outcome.packs !== null
        ? words.saved.packs(outcome.name, words.packs(outcome.packs))
        : null;

  // The product's packs in all its sizes, for "one more": 4 at most.
  const productPacks = (slug: string): number =>
    cart.items
      .filter((line) => line.product.slug === slug)
      .reduce((sum, line) => sum + line.packs, 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 pt-32 pb-24">
      <h1 className="heading-4 text-balance text-ink md:heading-3">
        {words.title}
      </h1>

      {said ? (
        <output
          ref={status}
          tabIndex={-1}
          className="body-4 block rounded-3xl bg-primary-soft p-6 text-ink outline-none"
        >
          {said}
        </output>
      ) : null}
      {outcome?.problem ? (
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">{words.problems[outcome.problem]}</p>
        </FormAlert>
      ) : null}

      {cart.items.length === 0 ? (
        <EmptyState title={words.empty} hint={words.emptyHint}>
          <Link prefetch="intent" to="/shop" className={GOLD_PILL}>
            {words.browse}
          </Link>
        </EmptyState>
      ) : (
        <div className="grid gap-8 lg:grid-cols-3">
          <section
            aria-labelledby="lines-heading"
            className="flex flex-col gap-4 lg:col-span-2"
          >
            <h2 id="lines-heading" className="sr-only">
              {words.lines}
            </h2>
            <ul className="flex flex-col gap-4">
              {cart.items.map((line) => (
                <Line
                  key={line.sku}
                  line={line}
                  room={MOST_PACKS - productPacks(line.product.slug)}
                  sending={
                    sending?.get('sku') === line.sku ? sending : undefined
                  }
                />
              ))}
            </ul>
          </section>
          <Summary
            packs={cart.packs}
            subtotal={cart.subtotalRupees}
            mrpTotal={cart.mrpTotalRupees}
          />
        </div>
      )}
    </div>
  );
}

// One more or one fewer: round, 48 px, outlined like a quiet pill.
const STEP =
  'button-md inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-line-strong text-ink transition hover:bg-surface-muted active:scale-98';

// One line: the product's photo and name, its pack size and price, its
// packs, one more or fewer, and taking it out.
function Line({
  line,
  room,
  sending,
}: {
  line: CartLine;
  room: number;
  sending: FormData | undefined;
}) {
  const which = lineName(line);
  const saving = line.mrpRupees - line.priceRupees;
  const canBuy = line.status === 'AVAILABLE';
  return (
    <li className="flex flex-col gap-4 rounded-3xl bg-surface p-4 sm:flex-row sm:p-6">
      {/* 24 px corners, 16 to 24 px in: the photo's are 8 px. */}
      <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-muted">
        {line.product.imageUrl ? (
          <img
            src={line.product.imageUrl}
            alt=""
            width={96}
            height={96}
            loading="lazy"
            decoding="async"
            className="size-full object-contain"
          />
        ) : (
          <Leaf
            aria-hidden="true"
            weight="light"
            className="size-8 text-ink-muted"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="title-3 break-words text-ink">
            <Link
              prefetch="intent"
              to={`/products/${line.product.slug}`}
              className="transition-colors duration-300 ease-settle hover:text-primary"
            >
              {line.product.name}
            </Link>
          </h3>
          <p className="body-6 text-ink-muted">{packName(line)}</p>
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="body-4 text-ink">
              {words.each(rupees(line.priceRupees))}
            </span>
            {saving > 0 ? (
              <s className="caption-2 text-ink-muted">
                {text.productPage.packs.mrp(rupees(line.mrpRupees))}
              </s>
            ) : null}
          </p>
          {line.status === 'AVAILABLE' ? null : (
            <p className="caption-1 text-ink-muted">
              {words.status[line.status]}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Form
            method="post"
            replace
            preventScrollReset
            className="flex items-center gap-2"
          >
            <input type="hidden" name="intent" value="packs" />
            <input type="hidden" name="sku" value={line.sku} />
            <BusyButton
              busy={sending?.get('packs') === String(line.packs - 1)}
              name="packs"
              value={String(line.packs - 1)}
              disabled={line.packs <= 1}
              label="−"
              busyLabel="−"
              fullLabel={words.fewer(which)}
              className={STEP}
            />
            <span className="body-4 min-w-16 text-center text-ink">
              {words.packs(line.packs)}
            </span>
            <BusyButton
              busy={sending?.get('packs') === String(line.packs + 1)}
              name="packs"
              value={String(line.packs + 1)}
              disabled={!canBuy || room <= 0}
              label="+"
              busyLabel="+"
              fullLabel={words.more(which)}
              className={STEP}
            />
          </Form>
          <Form method="post" replace preventScrollReset>
            <input type="hidden" name="intent" value="remove" />
            <input type="hidden" name="sku" value={line.sku} />
            <BusyButton
              busy={sending?.get('intent') === 'remove'}
              label={words.remove}
              busyLabel={words.removing}
              fullLabel={words.removeFor(which)}
              className={OUTLINE_PILL}
            />
          </Form>
          {canBuy ? (
            <p className="body-1 ml-auto text-ink">
              {rupees(line.lineTotalRupees)}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

// What the lines that can be bought come to, at today's prices.
function Summary({
  packs,
  subtotal,
  mrpTotal,
}: {
  packs: number;
  subtotal: number;
  mrpTotal: number;
}) {
  const saving = mrpTotal - subtotal;
  return (
    <section
      aria-labelledby="summary-heading"
      className="flex h-fit flex-col gap-4 rounded-3xl bg-surface p-6 lg:sticky lg:top-24"
    >
      <h2 id="summary-heading" className="title-1 text-ink">
        {words.summary.heading}
      </h2>
      <p className="body-6 text-ink-muted">{words.summary.packs(packs)}</p>
      <dl className="flex flex-col gap-2">
        {saving > 0 ? (
          <>
            <div className="flex justify-between gap-4">
              <dt className="body-6 text-ink-muted">{words.summary.mrp}</dt>
              <dd className="body-6 text-ink-muted">
                <s>{rupees(mrpTotal)}</s>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="body-6 text-primary">{words.summary.save}</dt>
              <dd className="body-6 text-primary">{rupees(saving)}</dd>
            </div>
          </>
        ) : null}
        <div className="flex justify-between gap-4 pt-2">
          <dt className="title-3 text-ink">{words.summary.subtotal}</dt>
          <dd className="title-3 text-ink">{rupees(subtotal)}</dd>
        </div>
      </dl>
      <p className="caption-2 text-ink-muted">{words.summary.delivery}</p>
      <p className="caption-2 text-ink-muted">{words.summary.gst}</p>
    </section>
  );
}
