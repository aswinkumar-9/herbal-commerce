import { ArrowLeft, FolderPlus, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../api/api-error';
import { problemMessage } from '../../api/problems';
import { useSession } from '../../auth/session-context';
import { buttonClass } from '../../components/Button';
import { usePageTitle } from '../../page-title';
import type { Product } from '../catalog-api';
import { useCategories, useProduct } from '../catalog-queries';
import { EmptyList, ListLoading, LoadFailed } from '../list-states';
import { ProductForm } from './ProductForm';

// A product's own page: /catalog/products/new for a new one, or
// /catalog/products/:id. The ID comes from the address bar, so one that is
// not an ID is never sent (catalog-api.ts).
export function ProductPage() {
  const { id } = useParams();
  return id === undefined ? <NewProduct /> : <EditProduct key={id} id={id} />;
}

// The list's filters, when staff came from it, so "Products" goes back to
// the list as they left it.
function useListSearch(): string {
  const { state } = useLocation() as { state: unknown };
  const search =
    state && typeof state === 'object' && 'listSearch' in state
      ? state.listSearch
      : '';
  return typeof search === 'string' ? search : '';
}

function useCanDelete(): boolean {
  const { state } = useSession();
  return state.status === 'signed-in' && state.staff.role === 'SUPER_USER';
}

function NewProduct() {
  usePageTitle('New product');
  const categories = useCategories();
  const listSearch = useListSearch();
  const [params] = useSearchParams();
  const chosen = params.get('category');
  const startCategory = categories.data?.some((c) => c.id === chosen)
    ? (chosen ?? undefined)
    : undefined;

  return (
    <Page title="New product" listSearch={listSearch}>
      {categories.isPending ? (
        <ListLoading label="Loading the categories…" />
      ) : categories.isError ? (
        <LoadFailed
          title="The categories could not be loaded"
          message={problemMessage(categories.error)}
          retrying={categories.isFetching}
          onRetry={() => void categories.refetch()}
        />
      ) : categories.data.length === 0 ? (
        <EmptyList
          icon={FolderPlus}
          title="Add a category first"
          action={
            <Link to="/catalog/categories" className={buttonClass('primary')}>
              Go to categories
            </Link>
          }
        >
          Every product is in a category.
        </EmptyList>
      ) : (
        <ProductForm
          product={null}
          categories={categories.data}
          startCategory={startCategory}
          listSearch={listSearch}
          canDelete={false}
        />
      )}
    </Page>
  );
}

function EditProduct({ id }: { id: string }) {
  const product = useProduct(id);
  const categories = useCategories();
  const listSearch = useListSearch();
  const canDelete = useCanDelete();
  usePageTitle(product.data?.name ?? 'Product');

  const missing =
    product.error instanceof ApiError && product.error.status === 404;

  return (
    <Page
      title={product.data?.name ?? (missing ? 'No such product' : 'Product')}
      product={product.data}
      listSearch={listSearch}
    >
      {product.isPending || (categories.isPending && !product.isError) ? (
        <ListLoading label="Loading the product…" />
      ) : missing ? (
        <EmptyList
          icon={SearchX}
          title="There is no such product"
          action={
            <Link
              to={{ pathname: '/catalog/products', search: listSearch }}
              className={buttonClass()}
            >
              Back to the products
            </Link>
          }
        >
          It may have been deleted, or the address is not quite right.
        </EmptyList>
      ) : product.isError ? (
        <LoadFailed
          title="The product could not be loaded"
          message={problemMessage(product.error)}
          retrying={product.isFetching}
          onRetry={() => void product.refetch()}
        />
      ) : categories.isError ? (
        <LoadFailed
          title="The categories could not be loaded"
          message={problemMessage(categories.error)}
          retrying={categories.isFetching}
          onRetry={() => void categories.refetch()}
        />
      ) : (
        <ProductForm
          key={product.data.id}
          product={product.data}
          categories={categories.data ?? []}
          listSearch={listSearch}
          canDelete={canDelete}
        />
      )}
    </Page>
  );
}

function Page({
  title,
  product,
  listSearch,
  children,
}: {
  title: string;
  product?: Product | undefined;
  listSearch: string;
  children: ReactNode;
}) {
  return (
    <section className="max-w-4xl">
      <Link
        to={{ pathname: '/catalog/products', search: listSearch }}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Products
      </Link>
      <header className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {product ? (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              product.isActive
                ? 'bg-primary-soft text-primary-strong'
                : 'bg-surface-muted text-ink-muted'
            }`}
          >
            {product.isActive ? 'Live' : 'Draft'}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}
