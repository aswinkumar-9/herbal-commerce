import { CheckCircle, MinusCircle } from '@phosphor-icons/react';
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Form, Link, data, redirect, useNavigation } from 'react-router';
import previewHome from '../art/preview-home.jpg';
import {
  addPath,
  addToCart,
  packsFrom,
  returnedFromSignIn,
} from '../cart.server.ts';
import type { AddOutcome } from '../cart.server.ts';
import { getProduct } from '../catalog.server.ts';
import type { Pack, Product } from '../catalog.server.ts';
import { getConfig } from '../config.server.ts';
import { BusyButton } from '../components/BusyButton.tsx';
import { FIELD } from '../components/FormField.tsx';
import { FormAlert, TEXT_LINK } from '../components/FormPage.tsx';
import { Gallery } from '../components/Gallery.tsx';
import { GOLD_PILL } from '../components/pills.ts';
import { given } from '../form-checks.server.ts';
import { Trail } from '../components/Trail.tsx';
import { pageTitle } from '../page-title.ts';
import { PACK_CHOICES, packName } from '../packs.ts';
import { rupees } from '../price.ts';
import { pageMeta } from '../seo.ts';
import { sessionOf } from '../session.server.ts';
import { isSlug, typeKeyOf } from '../shop-search.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/product';

// A product's own page (part 14A): its photos, its packs with their
// prices, MRP and whether each can be bought, what it is and how to use
// it, and the licence and maker details Indian labelling rules want shown.
// Search engines read it as a product from the page itself (schema.org
// microdata), with no script: the page's policy refuses inline ones.
const words = text.productPage;
const SCHEMA = 'https://schema.org/';

export async function loader({ request, params, context }: Route.LoaderArgs) {
  // An address no product could have is not asked of the API.
  if (!isSlug(params.slug)) {
    throw data(null, { status: 404 });
  }
  const product = await getProduct(request, params.slug);
  // The photo to show first, for a page without a script: ?photo=2.
  const search = new URL(request.url).searchParams;
  const asked = search.get('photo') ?? '';
  const photo = /^\d{1,2}$/.test(asked) ? Number(asked) : 1;
  return {
    product,
    photo: photo >= 1 && photo <= product.images.length ? photo - 1 : 0,
    origin: getConfig().origin,
    // Back from signing in to add a pack: what came of it.
    returned: await returnedFromSignIn(
      request,
      context,
      search,
      product.variants.map((pack) => pack.sku),
    ),
  };
}

// "Add to cart" (part 14C, ADR 0042): a pack size of this product, in
// stock, and 1 to 4 packs. Someone not signed in signs in first, and the
// pack goes in as they come back.
export async function action({ request, params, context }: Route.ActionArgs) {
  if (!isSlug(params.slug)) {
    throw data(null, { status: 404 });
  }
  const slug = params.slug;
  const form = await request.formData();
  const sku = given(form, 'sku');
  const packs = packsFrom(form.get('packs'));
  const product = await getProduct(request, slug);
  const pack = product.variants.find((found) => found.sku === sku);
  if (given(form, 'intent') !== 'add' || !pack || packs === null) {
    return outcome({ notAdded: 'choose' }, 400);
  }
  const choice = { sku, packs };
  if (!sessionOf(context).current) {
    throw redirect(
      `/sign-in?next=${encodeURIComponent(addPath(slug, sku, packs))}`,
    );
  }
  if (!pack.inStock) {
    return outcome({ notAdded: 'stock', choice }, 409);
  }
  const result = await addToCart(request, context, { sku, slug, packs });
  return result.ok
    ? outcome({ added: choice, choice }, 200)
    : outcome(
        { notAdded: result.why, room: result.room, choice },
        result.why === 'resting' ? 503 : 409,
      );
}

function outcome(said: Partial<AddOutcome>, status: number) {
  return data<AddOutcome>(
    {
      added: said.added ?? null,
      notAdded: said.notAdded ?? null,
      room: said.room ?? 0,
      choice: said.choice ?? null,
    },
    { status },
  );
}

export const lowestPrice = (packs: readonly Pack[]): number | null =>
  packs.length > 0 ? Math.min(...packs.map((pack) => pack.priceRupees)) : null;

export const meta: Route.MetaFunction = ({ loaderData }) => {
  // A page that could not be made: the status page names itself.
  if (!loaderData) {
    return [];
  }
  const { product, origin } = loaderData;
  const main = product.images[0];
  return pageMeta({
    title: pageTitle(product.name),
    description: product.summary ?? words.description(product.name),
    origin,
    // Its one address, whichever photo is shown.
    path: `/products/${product.slug}`,
    image: main
      ? {
          src: main.url,
          alt: main.altText,
          width: main.width,
          height: main.height,
        }
      : {
          src: previewHome,
          alt: text.home.previewAlt,
          width: 1200,
          height: 630,
        },
    price: lowestPrice(product.variants),
  });
};

export default function ProductPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { product, photo, origin } = loaderData;
  // What was just added, else what signing in made of it.
  const added: AddOutcome | null = actionData ?? loaderData.returned ?? null;
  const typeName = text.shopPage.types[typeKeyOf(product.type)];
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pt-24 pb-24">
      <Trail
        steps={[
          // A subcategory's top category first (part 15B).
          ...(product.category.parent ? [product.category.parent] : []),
          product.category,
        ].map((category) => ({
          label: category.name,
          to: `/categories/${category.slug}`,
        }))}
        here={product.name}
      />
      <article
        itemScope
        itemType={`${SCHEMA}Product`}
        className="grid gap-12 lg:grid-cols-2"
      >
        <link
          itemProp="url"
          href={new URL(`/products/${product.slug}`, origin).href}
        />
        {product.images.map((image) => (
          <link key={image.url} itemProp="image" href={image.url} />
        ))}
        {/* A new gallery for each product. */}
        <Gallery key={product.slug} images={product.images} first={photo} />
        <div className="flex flex-col gap-8">
          <header className="flex flex-col items-start gap-4">
            <p className="caption-3 rounded-full bg-primary-soft px-3 py-1 text-primary">
              {typeName}
            </p>
            <h1
              itemProp="name"
              className="heading-4 text-balance text-ink md:heading-3"
            >
              {product.name}
            </h1>
            {product.summary ? (
              <p
                itemProp="description"
                className="body-3 text-pretty text-ink-muted md:title-2"
              >
                {product.summary}
              </p>
            ) : null}
          </header>
          <Packs packs={product.variants} outcome={added} />
        </div>
        <div className="grid gap-6 lg:col-span-2 lg:grid-cols-2">
          {product.description ? (
            <Detail
              heading={words.about}
              itemProp={product.summary ? undefined : 'description'}
            >
              {product.description}
            </Detail>
          ) : null}
          <Detail heading={words.ingredients}>{product.ingredients}</Detail>
          {product.usage ? (
            <Detail heading={words.usage}>{product.usage}</Detail>
          ) : null}
          <Label product={product} />
        </div>
      </article>
    </div>
  );
}

// Each pack on sale with its price, its MRP (struck through when the price
// is lower, with what that saves), and whether it can be bought today. A
// customer chooses one in stock, and how many, for the cart (part 14C).
function Packs({
  packs,
  outcome,
}: {
  packs: readonly Pack[];
  outcome: AddOutcome | null;
}) {
  const navigation = useNavigation();
  const adding =
    navigation.state !== 'idle' &&
    navigation.formMethod === 'POST' &&
    navigation.formData?.get('intent') === 'add';
  const inStock = packs.filter((pack) => pack.inStock);
  const asked = outcome?.choice?.sku;
  const chosen =
    asked && inStock.some((pack) => pack.sku === asked)
      ? asked
      : inStock[0]?.sku;

  // The keyboard goes to what came of it: what was added, or why not.
  const status = useRef<HTMLOutputElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (outcome?.added) {
      status.current?.focus();
    } else if (outcome?.notAdded) {
      alert.current?.focus();
    }
  }, [outcome]);

  const added = outcome?.added
    ? packs.find((pack) => pack.sku === outcome.added?.sku)
    : undefined;

  return (
    <section aria-labelledby="packs-heading" className="flex flex-col gap-4">
      <h2 id="packs-heading" className="title-1 text-ink">
        {words.packs.heading}
      </h2>
      {packs.length === 0 ? (
        <p className="body-3 rounded-3xl bg-surface p-6 text-ink-muted">
          {words.packs.none}
        </p>
      ) : (
        <Form
          method="post"
          replace
          preventScrollReset
          className="flex flex-col gap-6"
        >
          <input type="hidden" name="intent" value="add" />
          <fieldset>
            <legend className="sr-only">{words.packs.heading}</legend>
            <ul className="grid gap-3 sm:grid-cols-2">
              {packs.map((pack) => (
                <PackChoice
                  key={pack.sku}
                  pack={pack}
                  chosen={pack.sku === chosen}
                />
              ))}
            </ul>
          </fieldset>
          {inStock.length > 0 ? (
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="packs" className="caption-1 text-ink-muted">
                  {words.add.howMany}
                </label>
                <select
                  id="packs"
                  name="packs"
                  defaultValue={String(outcome?.choice?.packs ?? 1)}
                  className={`${FIELD} w-28`}
                >
                  {PACK_CHOICES.map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </select>
              </div>
              <BusyButton
                busy={adding}
                label={words.add.submit}
                busyLabel={words.add.adding}
                className={GOLD_PILL}
              />
            </div>
          ) : (
            <p className="body-3 rounded-3xl bg-surface p-6 text-ink-muted">
              {words.add.noneInStock}
            </p>
          )}
        </Form>
      )}
      {outcome?.added && added ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-3xl bg-primary-soft p-6">
          <output
            ref={status}
            tabIndex={-1}
            className="body-4 text-ink outline-none"
          >
            {words.add.added(
              text.cart.packs(outcome.added.packs),
              packName(added),
            )}
          </output>
          <Link prefetch="intent" to="/cart" className={TEXT_LINK}>
            {words.add.seeCart}
          </Link>
        </div>
      ) : null}
      {outcome?.notAdded ? (
        <FormAlert alertRef={alert}>
          <p className="body-4 text-ink">
            {outcome.notAdded === 'full'
              ? words.add.problems.full(outcome.room)
              : words.add.problems[outcome.notAdded]}
          </p>
        </FormAlert>
      ) : null}
      <p className="caption-2 text-ink-muted">{words.packs.terms}</p>
    </section>
  );
}

// One pack size, to choose with its whole card: out of stock, it can't be.
// Read out by its size, then its price and whether it is in stock.
function PackChoice({ pack, chosen }: { pack: Pack; chosen: boolean }) {
  const saving = pack.mrpRupees - pack.priceRupees;
  const id = useId();
  return (
    <li
      itemProp="offers"
      itemScope
      itemType={`${SCHEMA}Offer`}
      className="flex"
    >
      <meta itemProp="sku" content={pack.sku} />
      <meta itemProp="priceCurrency" content="INR" />
      <link
        itemProp="availability"
        href={`${SCHEMA}${pack.inStock ? 'InStock' : 'OutOfStock'}`}
      />
      <label className="flex w-full cursor-pointer flex-col gap-2 rounded-3xl bg-surface p-6 ring-2 ring-transparent transition-colors duration-300 ease-settle has-checked:ring-primary has-disabled:cursor-not-allowed">
        <span className="flex items-center gap-3">
          <input
            type="radio"
            name="sku"
            value={pack.sku}
            defaultChecked={chosen}
            disabled={!pack.inStock}
            aria-labelledby={`${id}-name`}
            aria-describedby={`${id}-details`}
            className="size-5 shrink-0 accent-primary"
          />
          <span id={`${id}-name`} itemProp="name" className="title-2 text-ink">
            {packName(pack)}
          </span>
        </span>
        <span id={`${id}-details`} className="flex flex-col gap-2">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              itemProp="price"
              content={String(pack.priceRupees)}
              className="heading-6 text-ink"
            >
              {rupees(pack.priceRupees)}
            </span>
            {saving > 0 ? (
              <s className="body-6 text-ink-muted">
                {words.packs.mrp(rupees(pack.mrpRupees))}
              </s>
            ) : (
              <span className="body-6 text-ink-muted">
                {words.packs.mrp(rupees(pack.mrpRupees))}
              </span>
            )}
          </span>
          {saving > 0 ? (
            <span className="caption-1 text-primary">
              {words.packs.save(rupees(saving))}
            </span>
          ) : null}
          {pack.inStock ? (
            <span className="caption-1 flex items-center gap-2 text-ink">
              <CheckCircle
                aria-hidden="true"
                weight="fill"
                className="size-4 text-primary"
              />
              {words.packs.inStock}
            </span>
          ) : (
            <span className="caption-1 flex items-center gap-2 text-ink-muted">
              <MinusCircle
                aria-hidden="true"
                weight="light"
                className="size-4"
              />
              {words.packs.outOfStock}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}

// Words staff wrote, kept as they wrote them: each line on its own.
function Detail({
  heading,
  itemProp,
  children,
}: {
  heading: string;
  itemProp?: string | undefined;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-3xl bg-surface p-6 md:p-8"
    >
      <h2 id={id} className="title-1 text-ink">
        {heading}
      </h2>
      <p
        itemProp={itemProp}
        className="body-3 whitespace-pre-line text-pretty text-ink-muted"
      >
        {children}
      </p>
    </section>
  );
}

// The licence and the maker, in full.
function Label({ product }: { product: Product }) {
  const label = words.label;
  return (
    <section
      aria-labelledby="label-heading"
      className="flex flex-col gap-4 rounded-3xl bg-surface p-6 md:p-8"
    >
      <h2 id="label-heading" className="title-1 text-ink">
        {label.heading}
      </h2>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact term={label.licence[product.type]}>{product.licenceNumber}</Fact>
        {/* The maker is an item of its own for search engines, with its
            address inside it. A wrapper around both facts would break the
            list for screen readers, so the address goes along as a meta. */}
        <Fact term={label.maker}>
          <span
            itemProp="manufacturer"
            itemScope
            itemType={`${SCHEMA}Organization`}
          >
            <span itemProp="name">{product.manufacturerName}</span>
            <meta itemProp="address" content={product.manufacturerAddress} />
          </span>
        </Fact>
        <Fact term={label.address}>{product.manufacturerAddress}</Fact>
        <Fact term={label.origin} itemProp="countryOfOrigin">
          {product.countryOfOrigin}
        </Fact>
      </dl>
    </section>
  );
}

function Fact({
  term,
  itemProp,
  children,
}: {
  term: string;
  itemProp?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="caption-1 text-ink-muted">{term}</dt>
      <dd
        itemProp={itemProp}
        className="body-2 whitespace-pre-line text-pretty text-ink"
      >
        {children}
      </dd>
    </div>
  );
}
