import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Link, data, useFetcher } from 'react-router';
import previewHome from '../art/preview-home.jpg';
import { listCategoryProducts } from '../catalog.server.ts';
import type { ProductCard } from '../catalog.server.ts';
import { getConfig } from '../config.server.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { Trail } from '../components/Trail.tsx';
import {
  ProductGrid,
  ProductGridSkeleton,
} from '../components/ProductCard.tsx';
import { OUTLINE_PILL, PILL } from '../components/pills.ts';
import { pageTitle } from '../page-title.ts';
import { pageMeta } from '../seo.ts';
import { isSlug } from '../shop-search.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/category';

// A category's page (part 14A): its products, in the order staff chose.
// "Show more" adds the next ones below, without leaving the page; without
// a script, it is a link to the page of the next ones.
const words = text.categoryPage;

export async function loader({ request, params }: Route.LoaderArgs) {
  // An address no category could have is not asked of the API.
  if (!isSlug(params.slug)) {
    throw data(null, { status: 404 });
  }
  const asked = new URL(request.url).searchParams.get('after');
  const after = isSlug(asked) ? asked : undefined;
  const page = await listCategoryProducts(request, params.slug, after);
  return { ...page, after: after ?? null, origin: getConfig().origin };
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  // A page that could not be made: the status page names itself.
  if (!loaderData) {
    return [];
  }
  const { category, after, origin } = loaderData;
  return pageMeta({
    title: pageTitle(category.name),
    description: category.description ?? words.description(category.name),
    origin,
    path: `/categories/${category.slug}${after ? `?after=${after}` : ''}`,
    image: {
      src: previewHome,
      alt: text.home.previewAlt,
      width: 1200,
      height: 630,
    },
    // A later page of the list: not to be listed on its own.
    noindex: after !== null,
  });
};

export default function CategoryPage({ loaderData }: Route.ComponentProps) {
  const { category, products, nextAfter, after } = loaderData;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pt-24 pb-24">
      <Trail here={category.name} />
      <header className="flex flex-col gap-4">
        <h1 className="heading-3 text-balance text-ink md:heading-2">
          {category.name}
        </h1>
        {category.description ? (
          <p className="body-3 max-w-170 text-pretty text-ink-muted">
            {category.description}
          </p>
        ) : null}
      </header>
      {/* A new list for each category, or each later page. */}
      <Products
        key={`${category.slug}:${after ?? ''}`}
        slug={category.slug}
        first={products}
        next={nextAfter}
      />
      {after ? (
        <Link to={`/categories/${category.slug}`} className={OUTLINE_PILL}>
          {words.start}
        </Link>
      ) : null}
    </div>
  );
}

function Products({
  slug,
  first,
  next,
}: {
  slug: string;
  first: readonly ProductCard[];
  next: string | null;
}) {
  const fetcher = useFetcher<typeof loader>();
  const [batches, setBatches] = useState<(readonly ProductCard[])[]>([]);
  const [nextAfter, setNextAfter] = useState(next);
  const [seen, setSeen] = useState(fetcher.data);
  if (fetcher.data !== seen) {
    setSeen(fetcher.data);
    if (fetcher.data) {
      setBatches([...batches, fetcher.data.products]);
      setNextAfter(fetcher.data.nextAfter);
    }
  }
  const list = useRef<HTMLDivElement>(null);

  // The keyboard lands on the first of the products just added.
  useEffect(() => {
    if (batches.length === 0) {
      return;
    }
    const firsts = list.current?.querySelectorAll('[data-batch-start] a');
    (firsts?.[firsts.length - 1] as HTMLElement | undefined)?.focus();
  }, [batches.length]);

  // Each product once, should a list have changed between two pages.
  const products: ProductCard[] = [];
  const starts = new Set<number>();
  const known = new Set<string>();
  for (const [index, batch] of [first, ...batches].entries()) {
    if (index > 0) {
      starts.add(products.length);
    }
    for (const product of batch) {
      if (!known.has(product.slug)) {
        known.add(product.slug);
        products.push(product);
      }
    }
  }

  if (products.length === 0) {
    return (
      <EmptyState title={words.empty}>
        <Link to="/shop" className={PILL}>
          {text.shopPage.seeAll}
        </Link>
      </EmptyState>
    );
  }

  const loading = fetcher.state !== 'idle';
  const more = nextAfter ? `/categories/${slug}?after=${nextAfter}` : null;
  const showMore = (event: MouseEvent<HTMLAnchorElement>): void => {
    // Opening it in a new tab still works as a link.
    if (
      !more ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    if (!loading) {
      void fetcher.load(more);
    }
  };
  const last = batches.at(-1);

  return (
    <div
      ref={list}
      aria-busy={loading}
      className="flex flex-col items-center gap-8"
    >
      <div className="w-full">
        <ProductGrid products={products} firstOfBatch={starts} />
      </div>
      {loading ? (
        <div className="w-full">
          <ProductGridSkeleton count={4} />
        </div>
      ) : null}
      <output className="sr-only">
        {last ? words.shown(last.length) : ''}
      </output>
      {more ? (
        <Link to={more} onClick={showMore} className={OUTLINE_PILL}>
          {words.more}
        </Link>
      ) : null}
    </div>
  );
}
