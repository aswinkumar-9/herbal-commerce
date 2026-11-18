import {
  Boxes,
  ChevronRight,
  CircleCheck,
  Clock,
  Plus,
  Search,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { problemMessage } from '../api/problems';
import { EmptyList, ListLoading, LoadFailed } from '../catalog/list-states';
import { packName } from '../catalog/products/pack-size-form';
import { Button, buttonClass } from '../components/Button';
import { SearchBox, searchWords, tidyWords } from '../components/SearchBox';
import { transition } from '../motion';
import { usePageTitle } from '../page-title';
import { STOCK_FILTERS } from './stock-api';
import type { StockFilter, StockLine } from './stock-api';
import { dayName, stockCounts } from './stock-display';
import { useStockPages } from './stock-queries';
import { LevelTag, Tag } from './StockTags';

const FILTERS: { value: StockFilter | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'out', label: 'Out of stock' },
  { value: 'low', label: 'Low or out' },
  { value: 'expiring', label: 'Expiring soon' },
];

// What an empty filter means: good news.
const NOTHING: Record<StockFilter, { title: string; text: string }> = {
  out: {
    title: 'Nothing is out of stock',
    text: 'Every pack size has packs that may be sold.',
  },
  low: {
    title: 'Nothing is low',
    text: 'Every pack size has more packs than its low-stock number.',
  },
  expiring: {
    title: 'Nothing stops selling soon',
    text: 'No batch with packs in it stops selling in the next 30 days.',
  },
};

interface ProductGroup {
  product: StockLine['product'];
  lines: StockLine[];
}

// The API lists pack sizes by product: each run of one product's is a
// group, even across pages.
function byProduct(lines: StockLine[]): ProductGroup[] {
  const groups: ProductGroup[] = [];
  for (const line of lines) {
    const last = groups.at(-1);
    if (last && last.product.id === line.product.id) {
      last.lines.push(line);
    } else {
      groups.push({ product: line.product, lines: [line] });
    }
  }
  return groups;
}

// Every pack size's stock (ADR 0034), drafts and those off sale too: what
// may be sold, what orders hold, and when a batch stops selling. Filtered
// to those out of stock, low or expiring soon, and found by product name or
// SKU. The filters live in the address, so the list comes back as it was.
export function StockPage() {
  usePageTitle('Stock');
  const [params, setParams] = useSearchParams();
  const chosen = params.get('status');
  const status = STOCK_FILTERS.find((filter) => filter === chosen);
  const words = searchWords(params.get('q') ?? '');
  const stock = useStockPages({ status, q: words });

  const lines = stock.data?.pages.flatMap((page) => page.lines) ?? [];
  const groups = byProduct(lines);

  function setFilter(name: string, value: string | undefined) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) {
          next.set(name, value);
        } else {
          next.delete(name);
        }
        return next;
      },
      { replace: true },
    );
  }

  const [searchText, setSearchText] = useState(params.get('q') ?? '');
  const clearFilters = () => {
    setSearchText('');
    setParams(new URLSearchParams(), { replace: true });
  };

  return (
    <section className="max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">Stock</h1>
        <p className="mt-1 text-ink-muted">
          Every pack size, drafts and those off sale too. Packs may be sold from
          batches with at least 6 months left.
        </p>
      </header>

      <div className="mt-6 grid items-end gap-4 sm:grid-cols-[1fr_auto]">
        <SearchBox
          label="Search by product or SKU"
          text={searchText}
          onText={setSearchText}
          onSearch={(text) => setFilter('q', tidyWords(text) || undefined)}
          current={params.get('q') ?? ''}
        />
        <fieldset className="min-w-0">
          <legend className="text-sm font-medium">Show</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {FILTERS.map((filter) => {
              const pressed = status === filter.value;
              return (
                <button
                  key={filter.label}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setFilter('status', filter.value)}
                  className={`relative h-11 rounded-full px-4 text-sm font-medium transition-colors duration-150 ${
                    pressed
                      ? 'text-primary-strong'
                      : 'border border-line bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink'
                  }`}
                >
                  {pressed ? (
                    <motion.span
                      layoutId="stock-filter"
                      transition={transition}
                      aria-hidden="true"
                      className="absolute inset-0 rounded-full border border-primary/60 bg-primary-soft"
                    />
                  ) : null}
                  <span className="relative">{filter.label}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      {stock.isPending ? (
        <ListLoading label="Loading the stock…" />
      ) : stock.isError && !stock.data ? (
        <LoadFailed
          title="The stock could not be loaded"
          message={problemMessage(stock.error)}
          retrying={stock.isFetching}
          onRetry={() => void stock.refetch()}
        />
      ) : groups.length === 0 ? (
        words ? (
          <EmptyList
            icon={Search}
            title="No pack sizes match"
            action={<Button onClick={clearFilters}>Clear the filters</Button>}
          >
            {status
              ? 'No product name or SKU has these words in what you chose.'
              : 'No product name or SKU has these words.'}
          </EmptyList>
        ) : status ? (
          <EmptyList
            icon={CircleCheck}
            title={NOTHING[status].title}
            action={<Button onClick={clearFilters}>Show all</Button>}
          >
            {NOTHING[status].text}
          </EmptyList>
        ) : (
          <EmptyList
            icon={Boxes}
            title="No pack sizes yet"
            action={
              <Link to="/catalog/products" className={buttonClass('primary')}>
                <Plus aria-hidden="true" className="size-4" />
                Go to the products
              </Link>
            }
          >
            Stock is kept for each pack size of a product. Add a product and its
            pack sizes first.
          </EmptyList>
        )
      ) : (
        <ul
          aria-label="Stock by product"
          className={`mt-8 space-y-4 transition-opacity duration-150 ${
            stock.isPlaceholderData ? 'opacity-60' : ''
          }`}
        >
          {groups.map((group, index) => (
            <motion.li
              key={group.product.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: {
                  ...transition,
                  delay: Math.min(index, 10) * 0.03,
                },
              }}
              className="overflow-hidden rounded-card border border-line bg-surface"
            >
              <ProductStock group={group} listSearch={params.toString()} />
            </motion.li>
          ))}
        </ul>
      )}

      {stock.hasNextPage ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          {stock.isFetchNextPageError ? (
            <p role="alert" className="text-sm text-danger">
              More pack sizes could not be loaded. {problemMessage(stock.error)}
            </p>
          ) : null}
          <Button
            onClick={() => void stock.fetchNextPage()}
            busy={stock.isFetchingNextPage}
            busyLabel="Loading…"
          >
            Show more
          </Button>
        </div>
      ) : null}
    </section>
  );
}

// One product's pack sizes, with a way to its page in the catalog.
function ProductStock({
  group: { product, lines },
  listSearch,
}: {
  group: ProductGroup;
  listSearch: string;
}) {
  const headingId = `stock-${product.id}`;
  return (
    <>
      <div className="flex items-center gap-2 border-b border-line bg-surface-muted/50 px-4 py-2.5">
        <h2 id={headingId} className="truncate font-medium">
          {product.name}
        </h2>
        {product.isActive ? null : <Tag>Draft</Tag>}
        <Link
          to={`/catalog/products/${product.id}`}
          className="ml-auto shrink-0 rounded text-sm text-primary hover:underline"
        >
          Open product<span className="sr-only">: {product.name}</span>
        </Link>
      </div>
      <ul aria-labelledby={headingId} className="divide-y divide-line">
        {lines.map((line) => (
          <PackStock
            key={line.variant.id}
            line={line}
            listSearch={listSearch}
          />
        ))}
      </ul>
    </>
  );
}

// One pack size: what may be sold and what orders hold, when its next
// batch stops selling, and whether it is out, low or in stock. The whole
// row opens its batches.
function PackStock({
  line: { variant, product, stock },
  listSearch,
}: {
  line: StockLine;
  listSearch: string;
}) {
  return (
    <li className="relative flex items-start gap-4 px-4 py-3 transition-colors duration-150 hover:bg-surface-muted/40">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to={`/stock/${variant.id}`}
            state={{ listSearch }}
            className="font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary focus-visible:after:ring-inset"
          >
            {packName(variant)}
            <span className="sr-only">, {product.name}</span>
          </Link>
          <span className="font-mono text-xs text-ink-muted">
            {variant.sku}
          </span>
          {variant.isActive ? null : <Tag>Off sale</Tag>}
        </p>
        <p className="mt-1 text-sm text-ink-muted">{stockCounts(stock)}</p>
        {stock.stopsSellingOn ? (
          <p
            className={`mt-0.5 flex items-center gap-1.5 text-sm ${
              stock.expiringSoon ? 'font-medium text-warning' : 'text-ink-muted'
            }`}
          >
            {stock.expiringSoon ? (
              <Clock aria-hidden="true" className="size-3.5 shrink-0" />
            ) : null}
            A batch stops selling on {dayName(stock.stopsSellingOn)}
            {stock.expiringSoon ? ', within 30 days' : ''}
          </p>
        ) : null}
      </div>
      <LevelTag level={stock.level} />
      <ChevronRight
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-ink-muted"
      />
    </li>
  );
}
