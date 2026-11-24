import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { ChevronRight, PackagePlus, Plus, Search } from 'lucide-react';
import {
  AnimatePresence,
  Reorder,
  motion,
  useDragControls,
} from 'motion/react';
import type { KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { problemMessage } from '../../api/problems';
import { Button, buttonClass } from '../../components/Button';
import { SelectField } from '../../components/Field';
import { SearchBox, searchWords, tidyWords } from '../../components/SearchBox';
import { useToasts } from '../../components/toast-context';
import { DURATION, EASE_OUT, transition } from '../../motion';
import { usePageTitle } from '../../page-title';
import { PRODUCT_TYPE_NAMES, isId, reorderProducts } from '../catalog-api';
import type { Category, Product, ProductPage } from '../catalog-api';
import {
  catalogKeys,
  useCategories,
  useProductPages,
} from '../catalog-queries';
import { categoryLabel, labelOf } from '../category-tree';
import { EmptyList, ListLoading, LoadFailed } from '../list-states';
import { DragHandle, OrderBar, useReorder } from '../reorder';
import { missingToGoLive } from './product-form';

// A page holds this many: most categories fit on one, so their order can
// be changed straight away.
const PAGE_SIZE = 100;

type Status = 'live' | 'draft';

// Every product, drafts too: found by name, or by category and status. With
// one category chosen and nothing else, staff drag its products into the
// order customers see. The filters live in the address, so the list comes
// back as it was after opening a product.
export function ProductsPage() {
  usePageTitle('Products');
  const [params, setParams] = useSearchParams();
  const categories = useCategories();

  const chosen = params.get('category');
  const categoryId = isId(chosen) ? chosen : undefined;
  const statusParam = params.get('status');
  const status: Status | undefined =
    statusParam === 'live' || statusParam === 'draft' ? statusParam : undefined;
  const words = searchWords(params.get('q') ?? '');
  const query = {
    categoryId,
    isActive: status === undefined ? undefined : status === 'live',
    q: words,
    limit: PAGE_SIZE,
  };
  const products = useProductPages(query);

  const filtered = Boolean(categoryId || status || words);
  const loaded = products.data?.pages.flatMap((page) => page.products) ?? [];
  const category = categories.data?.find((c) => c.id === categoryId);
  // The order can be changed with every product of one category on screen:
  // the API takes the whole list, drafts too.
  const ordering =
    categoryId !== undefined &&
    status === undefined &&
    words === undefined &&
    !products.isPlaceholderData;

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

  const searchClear = () => {
    setParams(new URLSearchParams(), { replace: true });
  };

  return (
    <section className="max-w-4xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="mt-1 text-ink-muted">
            Everything in the shop, drafts too.
          </p>
        </div>
        <Link
          to={
            categoryId
              ? `/catalog/products/new?category=${categoryId}`
              : '/catalog/products/new'
          }
          className={buttonClass('primary')}
        >
          <Plus aria-hidden="true" className="size-4" />
          New product
        </Link>
      </header>

      <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_12rem_10rem]">
        <SearchBox
          label="Search by name"
          onSearch={(text) => setFilter('q', tidyWords(text) || undefined)}
          current={params.get('q') ?? ''}
        />
        <SelectField
          label="Category"
          value={categoryId ?? ''}
          onChange={(event) =>
            setFilter('category', event.target.value || undefined)
          }
        >
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {categoryLabel(categories.data, c)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Status"
          value={status ?? ''}
          onChange={(event) =>
            setFilter('status', event.target.value || undefined)
          }
        >
          <option value="">Live and drafts</option>
          <option value="live">Live</option>
          <option value="draft">Drafts</option>
        </SelectField>
      </div>

      {products.isPending ? (
        <ListLoading label="Loading the products…" />
      ) : products.isError && !products.data ? (
        <LoadFailed
          title="The products could not be loaded"
          message={problemMessage(products.error)}
          retrying={products.isFetching}
          onRetry={() => void products.refetch()}
        />
      ) : loaded.length === 0 ? (
        filtered ? (
          <EmptyList
            icon={Search}
            title="No products match"
            action={<Button onClick={searchClear}>Clear the filters</Button>}
          >
            {words
              ? 'No product name is close to these words in what you chose.'
              : 'Nothing is in what you chose.'}
          </EmptyList>
        ) : (
          <EmptyList
            icon={PackagePlus}
            title="No products yet"
            action={
              <Link
                to="/catalog/products/new"
                className={buttonClass('primary')}
              >
                <Plus aria-hidden="true" className="size-4" />
                Add the first product
              </Link>
            }
          >
            A product starts as a draft: customers see it once its details and
            an image are in, and it is made live.
          </EmptyList>
        )
      ) : ordering && category && !products.hasNextPage ? (
        <OrderedProducts
          key={category.id}
          category={category}
          products={loaded}
          query={query}
          listSearch={params.toString()}
        />
      ) : (
        <>
          <p className="mt-8 text-sm text-ink-muted">
            {words
              ? 'The closest names first.'
              : !categoryId
                ? 'Choose a category to change the order of its products.'
                : status
                  ? 'Choose “Live and drafts” to change the order.'
                  : products.hasNextPage
                    ? 'Show all of them to change their order.'
                    : null}
          </p>
          <motion.ul
            aria-label="Products"
            className={`mt-3 space-y-2 transition-opacity duration-150 ${
              products.isPlaceholderData ? 'opacity-60' : ''
            }`}
          >
            {loaded.map((product, index) => (
              <motion.li
                key={product.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: {
                    ...transition,
                    delay: Math.min(index % PAGE_SIZE, 10) * 0.03,
                  },
                }}
                className="relative flex items-center gap-3 rounded-card border border-line bg-surface p-3 shadow-clay-sm inset-shadow-clay transition-[border-color,box-shadow] duration-150 hover:border-primary/40 hover:shadow-clay"
              >
                <ProductSummary
                  product={product}
                  categoryName={
                    categoryId
                      ? undefined
                      : labelOf(categories.data ?? [], product.categoryId)
                  }
                  listSearch={params.toString()}
                />
              </motion.li>
            ))}
          </motion.ul>
        </>
      )}

      {products.hasNextPage ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          {products.isFetchNextPageError ? (
            <p role="alert" className="text-sm text-danger">
              More products could not be loaded.{' '}
              {problemMessage(products.error)}
            </p>
          ) : null}
          <Button
            onClick={() => void products.fetchNextPage()}
            busy={products.isFetchingNextPage}
            busyLabel="Loading…"
          >
            Show more
          </Button>
        </div>
      ) : null}
    </section>
  );
}

// One product in the list: its name opens its page (the whole row does).
function ProductSummary({
  product,
  categoryName,
  listSearch,
}: {
  product: Product;
  // Left out when the list is one category.
  categoryName?: string | undefined;
  listSearch: string;
}) {
  const missing = product.isActive ? [] : missingToGoLive(product);
  const details = [
    categoryName,
    product.type ? PRODUCT_TYPE_NAMES[product.type] : undefined,
  ].filter(Boolean);
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            to={`/catalog/products/${product.id}`}
            state={{ listSearch }}
            className="truncate font-medium after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary"
          >
            {product.name}
          </Link>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              product.isActive
                ? 'bg-primary-soft text-primary-strong'
                : 'bg-surface-muted text-ink-muted'
            }`}
          >
            {product.isActive ? 'Live' : 'Draft'}
          </span>
        </div>
        <p className="truncate text-sm text-ink-muted">
          {details.length > 0 ? `${details.join(' · ')} · ` : ''}
          <span className="font-mono text-xs">/{product.slug}</span>
        </p>
        {missing.length > 0 ? (
          <p className="mt-0.5 text-xs text-ink-muted">
            {missing.length === 1
              ? '1 detail to fill in before it can go live'
              : `${missing.length} details to fill in before it can go live`}
          </p>
        ) : null}
      </div>
      <ChevronRight aria-hidden="true" className="size-4 text-ink-muted" />
    </>
  );
}

// One category's products, in the order customers see them, to drag or
// move with the keys.
function OrderedProducts({
  category,
  products,
  query,
  listSearch,
}: {
  category: Category;
  products: Product[];
  query: Parameters<typeof catalogKeys.products>[0];
  listSearch: string;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const order = useReorder({
    items: products,
    send: (ids) => reorderProducts(category.id, ids),
    onSaved: (saved) => {
      // The whole category, on one page, as the server now has it.
      queryClient.setQueryData<InfiniteData<ProductPage, string | undefined>>(
        catalogKeys.products(query),
        {
          pages: [{ products: saved, nextAfter: null }],
          pageParams: [undefined],
        },
      );
    },
    onFailed: (error) => {
      toasts.show(problemMessage(error), 'error');
      void queryClient.invalidateQueries({
        queryKey: catalogKeys.products(query),
      });
    },
  });

  return (
    <>
      <OrderBar order={order} noun="product">
        Drag a handle to change the order customers see in {category.name}.
      </OrderBar>
      <Reorder.Group
        as="ol"
        axis="y"
        values={order.rowIds}
        onReorder={order.arrange}
        aria-label={`${category.name}, in the order customers see them`}
        className="mt-3 space-y-2"
      >
        <AnimatePresence initial={false}>
          {order.rows.map((product, index) => (
            <OrderedRow
              key={product.id}
              product={product}
              index={index}
              helpId={order.helpId}
              listSearch={listSearch}
              onKeyMove={(event) => order.keyMove(product, event)}
              onDragStart={() => order.dragStart(product)}
              onDrop={() => order.drop(product)}
            />
          ))}
        </AnimatePresence>
      </Reorder.Group>
    </>
  );
}

function OrderedRow({
  product,
  index,
  helpId,
  listSearch,
  onKeyMove,
  onDragStart,
  onDrop,
}: {
  product: Product;
  index: number;
  helpId: string;
  listSearch: string;
  onKeyMove: (event: KeyboardEvent) => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      as="li"
      value={product.id}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDrop}
      initial={{ opacity: 0, y: 6 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: { ...transition, delay: Math.min(index, 10) * 0.03 },
      }}
      exit={{
        opacity: 0,
        transition: { duration: DURATION.fast, ease: EASE_OUT },
      }}
      whileDrag={{ scale: 1.01, boxShadow: '0 12px 32px rgb(16 24 18 / 0.16)' }}
      className="relative flex items-center gap-3 rounded-card border border-line bg-surface p-3 shadow-clay-sm inset-shadow-clay transition-[border-color,box-shadow] duration-150 hover:border-primary/40 hover:shadow-clay"
    >
      <DragHandle
        label={`Move ${product.name}`}
        helpId={helpId}
        controls={controls}
        onKeyDown={onKeyMove}
      />
      <ProductSummary product={product} listSearch={listSearch} />
    </Reorder.Item>
  );
}
