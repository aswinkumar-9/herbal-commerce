import {
  CaretDown,
  CaretLeft,
  CaretRight,
  Funnel,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react';
import { useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { Link, useNavigate, useNavigation } from 'react-router';
import previewHome from '../art/preview-home.jpg';
import { listCategories, searchProducts } from '../catalog.server.ts';
import type { Category, SearchPage } from '../catalog.server.ts';
import { getConfig } from '../config.server.ts';
import {
  ProductGrid,
  ProductGridSkeleton,
} from '../components/ProductCard.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { GOLD_PILL, OUTLINE_PILL, PILL } from '../components/pills.ts';
import { pageTitle } from '../page-title.ts';
import { rupees } from '../price.ts';
import { pageMeta } from '../seo.ts';
import {
  LAST_PAGE,
  PAGE_SIZE,
  SEARCH_MAX,
  SEARCH_MIN,
  TYPE_KEYS,
  filtersInUse,
  readShopSearch,
  shopHref,
  usualSort,
} from '../shop-search.ts';
import type { SearchProblems, ShopSearch, Typed } from '../shop-search.ts';
import { text } from '../text/en.ts';
import type { Route } from './+types/shop';

// The shop (part 14A): every product on sale, searched by words, partial
// or misspelt, filtered by category, type and price, and sorted; products
// in stock first. All of it is in the address, so a search can be shared,
// and the form works without a script. With one, a new choice shows its
// results at once and the page stays where it is.
const shop = text.shopPage;
const FORM = 'shop-search';

export async function loader({ request }: Route.LoaderArgs) {
  const { search, problems, typed } = readShopSearch(
    new URL(request.url).searchParams,
  );
  const categories = await listCategories(request);
  // A category no longer on show is left out, like any other stale part.
  const asked: ShopSearch = categories.some(
    (category) => category.slug === search.category,
  )
    ? search
    : { ...search, category: undefined };
  return {
    search: asked,
    problems,
    typed,
    categories,
    found: await searchProducts(request, asked),
    origin: getConfig().origin,
  };
}

export const meta: Route.MetaFunction = ({ loaderData, location }) => {
  const words = loaderData?.search.q;
  const title = pageTitle(words ? shop.resultsTitle(words) : shop.title);
  return loaderData
    ? pageMeta({
        title,
        description: shop.description,
        origin: loaderData.origin,
        path: `/shop${location.search}`,
        image: {
          src: previewHome,
          alt: text.home.previewAlt,
          width: 1200,
          height: 630,
        },
        // A search or a filter is one view of the shop: not to be listed.
        noindex: location.search.length > 1,
      })
    : [{ title }];
};

// What the form holds, as text: the address's parts, or what was typed.
interface Fields {
  q: string;
  category: string;
  type: string;
  min: string;
  max: string;
  // Empty for the usual order for the words.
  sort: string;
}

const fieldsOf = (search: ShopSearch, typed: Typed): Fields => ({
  q: typed.q,
  category: search.category ?? '',
  type: search.type ?? '',
  min: typed.min,
  max: typed.max,
  sort: search.sort ?? '',
});

// The address for what the form holds, with the empty parts left out.
function addressOf(fields: Fields): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) {
    if (value.trim() !== '') {
      params.set(name, value.trim());
    }
  }
  return params.size > 0 ? `/shop?${params}` : '/shop';
}

export default function Shop({ loaderData }: Route.ComponentProps) {
  const { search, problems, typed, categories, found } = loaderData;
  const navigate = useNavigate();
  const navigation = useNavigation();
  const loading =
    navigation.state === 'loading' && navigation.location.pathname === '/shop';

  // The form follows the address when it changes (a link, Back), and keeps
  // the keyboard where it was.
  const [fields, setFields] = useState(() => fieldsOf(search, typed));
  const [shown, setShown] = useState(search);
  if (shown !== search) {
    setShown(search);
    setFields(fieldsOf(search, typed));
  }
  const edit =
    (name: keyof Fields) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      setFields({ ...fields, [name]: event.target.value });
    };
  // A choice from a list shows its results at once.
  const choose =
    (name: keyof Fields) =>
    (event: ChangeEvent<HTMLSelectElement>): void => {
      const next = { ...fields, [name]: event.target.value };
      setFields(next);
      void navigate(addressOf(next), { preventScrollReset: true });
    };
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void navigate(addressOf(fields), { preventScrollReset: true });
  };

  const pages = Math.min(Math.ceil(found.total / PAGE_SIZE), LAST_PAGE);
  const asked = search.q !== undefined || filtersInUse(search) > 0;
  const count = search.q
    ? shop.foundFor(found.total, search.q)
    : shop.found(found.total);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pt-24 pb-24">
      <h1 className="heading-3 mt-12 text-ink md:heading-2">{shop.heading}</h1>

      <search>
        <form
          id={FORM}
          method="get"
          action="/shop"
          onSubmit={onSubmit}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="q" className="sr-only">
              {shop.search.label}
            </label>
            <div className="flex gap-2 sm:gap-3">
              <div className="relative min-w-0 flex-1">
                <MagnifyingGlass
                  aria-hidden="true"
                  weight="light"
                  className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-muted"
                />
                <input
                  id="q"
                  name="q"
                  type="search"
                  value={fields.q}
                  onChange={edit('q')}
                  placeholder={shop.search.placeholder}
                  minLength={SEARCH_MIN}
                  maxLength={SEARCH_MAX}
                  autoComplete="off"
                  enterKeyHint="search"
                  aria-invalid={problems.q ? true : undefined}
                  aria-describedby={problems.q ? 'q-problem' : undefined}
                  className={`${FIELD} py-3 pr-4 pl-12`}
                />
              </div>
              <button type="submit" className={GOLD_PILL}>
                {shop.search.submit}
              </button>
            </div>
            <Problem id="q-problem" message={problems.q} />
          </div>

          <Filters
            search={search}
            problems={problems}
            fields={fields}
            categories={categories}
            onEdit={edit}
            onChoose={choose}
          />
        </form>
      </search>

      <FilterChips search={search} categories={categories} />

      <section
        aria-labelledby="results-heading"
        aria-busy={loading}
        className="flex flex-col gap-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="results-heading" className="title-2 text-ink">
            {count}
          </h2>
          <SortChoice
            words={search.q}
            value={fields.sort}
            onChoose={choose('sort')}
          />
        </div>
        {/* Says what changed to a screen reader, once it has. */}
        <output className="sr-only">{loading ? shop.loading : count}</output>
        {loading ? (
          <ProductGridSkeleton count={8} />
        ) : found.products.length > 0 ? (
          <ProductGrid products={found.products} />
        ) : found.total > 0 ? (
          <EmptyState title={shop.beyond}>
            <Link prefetch="intent" to={shopHref(search)} className={PILL}>
              {shop.firstPage}
            </Link>
          </EmptyState>
        ) : asked ? (
          <EmptyState title={shop.none} hint={shop.noneHint}>
            <Link prefetch="intent" to="/shop" className={PILL}>
              {shop.seeAll}
            </Link>
          </EmptyState>
        ) : (
          <EmptyState title={shop.stocking} />
        )}
        {!loading && found.products.length > 0 ? (
          <Pages search={search} found={found} pages={pages} />
        ) : null}
      </section>
    </div>
  );
}

const FIELD =
  'body-3 w-full rounded-full border border-line-strong bg-surface text-ink placeholder:text-ink-muted aria-invalid:border-danger';

function Filters({
  search,
  problems,
  fields,
  categories,
  onEdit,
  onChoose,
}: {
  search: ShopSearch;
  problems: SearchProblems;
  fields: Fields;
  categories: readonly Category[];
  onEdit: (
    name: keyof Fields,
  ) => (event: ChangeEvent<HTMLInputElement>) => void;
  onChoose: (
    name: keyof Fields,
  ) => (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  const inUse = filtersInUse(search);
  return (
    // Open when a price needs fixing, so its message shows.
    <details
      open={problems.min || problems.max ? true : undefined}
      className="group rounded-3xl bg-surface"
    >
      <summary className="title-3 flex cursor-pointer list-none items-center gap-3 rounded-3xl px-6 py-4 text-ink [&::-webkit-details-marker]:hidden">
        <Funnel aria-hidden="true" weight="light" className="size-5" />
        {shop.filters.summary}
        {inUse > 0 ? (
          <span className="caption-3 rounded-full bg-primary-soft px-3 py-1 text-primary">
            {shop.filters.inUse(inUse)}
          </span>
        ) : null}
        <CaretDown
          aria-hidden="true"
          weight="light"
          className="ml-auto size-5 transition-transform duration-500 group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="grid gap-4 px-6 pb-6 sm:grid-cols-2 lg:grid-cols-4">
        <Choice
          id="category"
          label={shop.filters.category}
          value={fields.category}
          onChange={onChoose('category')}
        >
          <option value="">{shop.filters.allCategories}</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </Choice>
        <Choice
          id="type"
          label={shop.filters.type}
          value={fields.type}
          onChange={onChoose('type')}
        >
          <option value="">{shop.filters.allTypes}</option>
          {TYPE_KEYS.map((key) => (
            <option key={key} value={key}>
              {shop.types[key]}
            </option>
          ))}
        </Choice>
        <PriceField
          id="min"
          label={shop.filters.min}
          value={fields.min}
          problem={problems.min}
          onChange={onEdit('min')}
        />
        <PriceField
          id="max"
          label={shop.filters.max}
          value={fields.max}
          problem={problems.max}
          onChange={onEdit('max')}
        />
        <div className="sm:col-span-2 lg:col-span-4">
          <button type="submit" className={PILL}>
            {shop.filters.apply}
          </button>
        </div>
      </div>
    </details>
  );
}

function Choice({
  id,
  label,
  value,
  onChange,
  form,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  // A list outside the form still belongs to it.
  form?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="caption-1 text-ink-muted">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          name={id}
          form={form}
          value={value}
          onChange={onChange}
          className={`${FIELD} cursor-pointer appearance-none py-3 pr-12 pl-4`}
        >
          {children}
        </select>
        <CaretDown
          aria-hidden="true"
          weight="light"
          className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-ink-muted"
        />
      </div>
    </div>
  );
}

function PriceField({
  id,
  label,
  value,
  problem,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  problem: string | undefined;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="caption-1 text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={7}
        value={value}
        onChange={onChange}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
        className={`${FIELD} px-4 py-3`}
      />
      <Problem id={`${id}-problem`} message={problem} />
    </div>
  );
}

function Problem({
  id,
  message,
}: {
  id: string;
  message?: string | undefined;
}) {
  return message ? (
    <p id={id} className="caption-2 px-4 text-danger">
      {message}
    </p>
  ) : null;
}

// The order, beside the count. It belongs to the search form; without a
// script, its own button applies it.
function SortChoice({
  words,
  value,
  onChoose,
}: {
  words: string | undefined;
  value: string;
  onChoose: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  const usual = usualSort(words);
  return (
    <div className="flex items-end gap-2">
      <Choice
        id="sort"
        label={shop.sort.label}
        value={value}
        onChange={onChoose}
        form={FORM}
      >
        <option value="">{shop.sort[usual]}</option>
        <option value="price-asc">{shop.sort['price-asc']}</option>
        <option value="price-desc">{shop.sort['price-desc']}</option>
        {usual === 'name' ? null : (
          <option value="name">{shop.sort.name}</option>
        )}
      </Choice>
      <noscript>
        <button type="submit" form={FORM} className={OUTLINE_PILL}>
          {shop.sort.apply}
        </button>
      </noscript>
    </div>
  );
}

// The filters in use, each a link that takes it away.
function FilterChips({
  search,
  categories,
}: {
  search: ShopSearch;
  categories: readonly Category[];
}) {
  const chips: { label: string; to: string }[] = [];
  const category = categories.find((each) => each.slug === search.category);
  if (category) {
    chips.push({
      label: category.name,
      to: shopHref(search, { category: undefined }),
    });
  }
  if (search.type) {
    chips.push({
      label: shop.types[search.type],
      to: shopHref(search, { type: undefined }),
    });
  }
  if (search.min !== undefined || search.max !== undefined) {
    chips.push({
      label: shop.priceRange(
        search.min === undefined ? undefined : rupees(search.min),
        search.max === undefined ? undefined : rupees(search.max),
      ),
      to: shopHref(search, { min: undefined, max: undefined }),
    });
  }
  if (chips.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ul aria-label={shop.filters.chipsLabel} className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.to}>
            <Link
              prefetch="intent"
              to={chip.to}
              preventScrollReset
              aria-label={shop.filters.remove(chip.label)}
              className="body-5 inline-flex items-center gap-2 rounded-full bg-primary-soft py-2 pr-3 pl-4 text-primary transition-colors hover:bg-primary hover:text-on-primary active:scale-98"
            >
              {chip.label}
              <X aria-hidden="true" weight="bold" className="size-4" />
            </Link>
          </li>
        ))}
      </ul>
      <Link
        prefetch="intent"
        to={shopHref(search, {
          category: undefined,
          type: undefined,
          min: undefined,
          max: undefined,
        })}
        preventScrollReset
        className="body-5 rounded-full px-2 py-2 text-primary underline underline-offset-4"
      >
        {shop.filters.clear}
      </Link>
    </div>
  );
}

function Pages({
  search,
  found,
  pages,
}: {
  search: ShopSearch;
  found: SearchPage;
  pages: number;
}) {
  if (pages <= 1) {
    return null;
  }
  return (
    <nav
      aria-label={shop.pages.label}
      className="flex flex-wrap items-center justify-between gap-4 pt-6"
    >
      {found.page > 1 ? (
        <Link
          prefetch="intent"
          to={shopHref(search, { page: found.page - 1 })}
          rel="prev"
          className={OUTLINE_PILL}
        >
          <CaretLeft aria-hidden="true" weight="bold" className="size-4" />
          {shop.pages.previous}
        </Link>
      ) : (
        <span />
      )}
      <p className="body-6 text-ink-muted">
        {shop.pages.at(found.page, pages)}
      </p>
      {found.nextPage && found.nextPage <= LAST_PAGE ? (
        <Link
          prefetch="intent"
          to={shopHref(search, { page: found.nextPage })}
          rel="next"
          className={OUTLINE_PILL}
        >
          {shop.pages.next}
          <CaretRight aria-hidden="true" weight="bold" className="size-4" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
