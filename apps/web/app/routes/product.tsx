import { CheckCircle, MinusCircle } from '@phosphor-icons/react';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { data } from 'react-router';
import previewHome from '../art/preview-home.jpg';
import { getProduct } from '../catalog.server.ts';
import type { Pack, Product } from '../catalog.server.ts';
import { getConfig } from '../config.server.ts';
import { Gallery } from '../components/Gallery.tsx';
import { Trail } from '../components/Trail.tsx';
import { pageTitle } from '../page-title.ts';
import { count, rupees } from '../price.ts';
import { pageMeta } from '../seo.ts';
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

export async function loader({ request, params }: Route.LoaderArgs) {
  // An address no product could have is not asked of the API.
  if (!isSlug(params.slug)) {
    throw data(null, { status: 404 });
  }
  const product = await getProduct(request, params.slug);
  // The photo to show first, for a page without a script: ?photo=2.
  const asked = new URL(request.url).searchParams.get('photo') ?? '';
  const photo = /^\d{1,2}$/.test(asked) ? Number(asked) : 1;
  return {
    product,
    photo: photo >= 1 && photo <= product.images.length ? photo - 1 : 0,
    origin: getConfig().origin,
  };
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

export default function ProductPage({ loaderData }: Route.ComponentProps) {
  const { product, photo, origin } = loaderData;
  const typeName = text.shopPage.types[typeKeyOf(product.type)];
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pt-24 pb-24">
      <Trail
        steps={[
          {
            label: product.category.name,
            to: `/categories/${product.category.slug}`,
          },
        ]}
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
          <Packs packs={product.variants} />
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

// A pack's net quantity, as its label gives it: 60 capsules, 1,000 g.
export const packName = ({ quantity, unit }: Pack): string =>
  words.units[unit](count(quantity));

// Each pack on sale with its price, its MRP (struck through when the price
// is lower, with what that saves), and whether it can be bought today.
function Packs({ packs }: { packs: readonly Pack[] }) {
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
        <ul className="grid gap-3 sm:grid-cols-2">
          {packs.map((pack) => {
            const saving = pack.mrpRupees - pack.priceRupees;
            return (
              <li
                key={pack.sku}
                itemProp="offers"
                itemScope
                itemType={`${SCHEMA}Offer`}
                className="flex flex-col gap-2 rounded-3xl bg-surface p-6"
              >
                <meta itemProp="sku" content={pack.sku} />
                <meta itemProp="priceCurrency" content="INR" />
                <link
                  itemProp="availability"
                  href={`${SCHEMA}${pack.inStock ? 'InStock' : 'OutOfStock'}`}
                />
                <p itemProp="name" className="title-2 text-ink">
                  {packName(pack)}
                </p>
                <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
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
                </p>
                {saving > 0 ? (
                  <p className="caption-1 text-primary">
                    {words.packs.save(rupees(saving))}
                  </p>
                ) : null}
                {pack.inStock ? (
                  <p className="caption-1 flex items-center gap-2 text-ink">
                    <CheckCircle
                      aria-hidden="true"
                      weight="fill"
                      className="size-4 text-primary"
                    />
                    {words.packs.inStock}
                  </p>
                ) : (
                  <p className="caption-1 flex items-center gap-2 text-ink-muted">
                    <MinusCircle
                      aria-hidden="true"
                      weight="light"
                      className="size-4"
                    />
                    {words.packs.outOfStock}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="caption-2 text-ink-muted">{words.packs.terms}</p>
    </section>
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
        <div
          itemProp="manufacturer"
          itemScope
          itemType={`${SCHEMA}Organization`}
          className="contents"
        >
          <Fact term={label.maker} itemProp="name">
            {product.manufacturerName}
          </Fact>
          <Fact term={label.address} itemProp="address">
            {product.manufacturerAddress}
          </Fact>
        </div>
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
