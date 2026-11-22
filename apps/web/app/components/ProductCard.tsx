import { Leaf } from '@phosphor-icons/react';
import { memo } from 'react';
import { Link } from 'react-router';
import type { ProductCard as Card } from '../catalog.server.ts';
import { rupees } from '../price.ts';
import { text } from '../text/en.ts';

// The first row of a list loads its photos at once, before anything else
// that waits (the first is the largest thing on a phone's first screen);
// the rest as they near the screen.
const FIRST_ROW = 4;

// The products of a list, as cards. Each card is one link, named by the
// product alone: its whole surface follows it. The names are headings one
// level under the list's own: h3 under the shop's h2 for its results, h2
// straight under a category's h1. Drawn again only when its products
// change, not at each key typed in the shop's search box above it.
export const ProductGrid = memo(function ProductGrid({
  products,
  firstOfBatch,
  headingLevel = 3,
}: {
  products: readonly Card[];
  // Where a batch added by "Show more" begins, for the keyboard to land.
  firstOfBatch?: ReadonlySet<number>;
  headingLevel?: 2 | 3;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
      {products.map((product, index) => (
        <li
          key={product.slug}
          data-batch-start={firstOfBatch?.has(index) ? '' : undefined}
        >
          <ProductCard
            product={product}
            eager={index < FIRST_ROW}
            headingLevel={headingLevel}
          />
        </li>
      ))}
    </ul>
  );
});

export function ProductCard({
  product,
  eager = false,
  headingLevel = 3,
}: {
  product: Card;
  eager?: boolean;
  headingLevel?: 2 | 3;
}) {
  const Name = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className="group relative flex h-full flex-col gap-3 rounded-3xl bg-surface p-3 transition-transform duration-500 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus active:scale-98">
      {/* 24 px corners, 12 px in: the photo's corners are 12 px. */}
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-surface-muted">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt=""
            width={400}
            height={400}
            loading={eager ? 'eager' : 'lazy'}
            fetchPriority={eager ? 'high' : undefined}
            decoding="async"
            className="size-full object-contain transition-transform duration-500 group-hover:scale-103 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <Leaf
            aria-hidden="true"
            weight="light"
            className="size-12 text-ink-muted"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-1 pb-1 sm:px-2 sm:pb-2">
        <Name className="title-3 text-ink">
          {/* Its box covers the card, so the whole card follows it. */}
          <Link
            prefetch="intent"
            to={`/products/${product.slug}`}
            className="after:absolute after:inset-0 after:rounded-3xl focus-visible:outline-none"
          >
            {product.name}
          </Link>
        </Name>
        {product.summary ? (
          <p className="body-6 line-clamp-2 text-ink-muted">
            {product.summary}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="body-4 text-ink">
            {product.fromPriceRupees === null
              ? text.card.notOnSale
              : text.card.from(rupees(product.fromPriceRupees))}
          </p>
          {product.inStock === false ? (
            <p className="caption-4 rounded-full bg-surface-muted px-3 py-1 text-ink-muted">
              {text.card.outOfStock}
            </p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

// While products load: shapes like the cards, gently pulsing (still, when
// the device asks for less motion).
export function ProductGridSkeleton({ count }: { count: number }) {
  return (
    <ul
      aria-hidden="true"
      className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4"
    >
      {Array.from({ length: count }, (_, index) => (
        <li
          key={index}
          data-skeleton
          className="flex flex-col gap-3 rounded-3xl bg-surface p-3 motion-safe:animate-pulse"
        >
          <div className="aspect-square rounded-xl bg-surface-muted" />
          <div className="flex flex-col gap-2 px-1 pb-1 sm:px-2 sm:pb-2">
            <div className="h-6 w-3/4 rounded-full bg-surface-muted" />
            <div className="h-4 w-full rounded-full bg-surface-muted" />
            <div className="h-4 w-1/3 rounded-full bg-surface-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}
