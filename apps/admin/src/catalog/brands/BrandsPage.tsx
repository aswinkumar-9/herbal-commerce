import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { problemMessage } from '../../api/problems';
import { useSession } from '../../auth/session-context';
import { Button } from '../../components/Button';
import { STAGGER, transition } from '../../motion';
import { usePageTitle } from '../../page-title';
import type { Brand } from '../catalog-api';
import { useBrands } from '../catalog-queries';
import { EmptyList, ListLoading, LoadFailed } from '../list-states';
import { BrandEditor } from './BrandEditor';
import { DeleteBrandDialog } from './DeleteBrandDialog';

// "No products", "1 product", "12 products".
export function productCount(count: number): string {
  if (count === 0) {
    return 'No products';
  }
  return count === 1
    ? '1 product'
    : `${count.toLocaleString('en-IN')} products`;
}

// The brands of the products, by name (part 15A). Admins and Super Users
// add and change them; only Super Users delete them, once no product has
// one.
export function BrandsPage() {
  usePageTitle('Brands');
  const brands = useBrands();
  const { state } = useSession();
  const canDelete =
    state.status === 'signed-in' && state.staff.role === 'SUPER_USER';

  const [editor, setEditor] = useState<{
    open: boolean;
    brand: Brand | null;
  }>({ open: false, brand: null });
  const [deleting, setDeleting] = useState<{
    open: boolean;
    brand: Brand | null;
  }>({ open: false, brand: null });
  const addNew = () => setEditor({ open: true, brand: null });

  return (
    <section className="max-w-4xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Brands</h1>
          <p className="mt-1 text-ink-muted">
            Who makes the products. Each product may have one brand.
          </p>
        </div>
        <Button variant="primary" icon={Plus} onClick={addNew}>
          New brand
        </Button>
      </header>

      {brands.isPending ? (
        <ListLoading label="Loading the brands…" />
      ) : brands.isError ? (
        <LoadFailed
          title="The brands could not be loaded"
          message={problemMessage(brands.error)}
          retrying={brands.isFetching}
          onRetry={() => void brands.refetch()}
        />
      ) : brands.data.length === 0 ? (
        <EmptyList
          icon={Tag}
          title="No brands yet"
          action={
            <Button variant="primary" icon={Plus} onClick={addNew}>
              Add the first brand
            </Button>
          }
        >
          A brand is who makes a product. Add one here, then choose it on the
          product&apos;s page.
        </EmptyList>
      ) : (
        <ul
          aria-label="Brands, by name"
          className="mt-6 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-clay inset-shadow-clay"
        >
          <AnimatePresence initial={false}>
            {brands.data.map((brand, index) => (
              <motion.li
                key={brand.id}
                layout="position"
                initial={{ opacity: 0, y: 6 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: {
                    ...transition,
                    delay: Math.min(index, 10) * STAGGER,
                  },
                }}
                exit={{ opacity: 0, transition }}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{brand.name}</p>
                  <p className="truncate text-xs text-ink-muted">
                    <span className="font-mono">{brand.slug}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="sr-only">, </span>
                    {productCount(brand.productCount)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Pencil}
                    aria-label={`Edit ${brand.name}`}
                    onClick={() => setEditor({ open: true, brand })}
                  >
                    Edit
                  </Button>
                  {canDelete ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash2}
                      aria-label={`Delete ${brand.name}`}
                      onClick={() => setDeleting({ open: true, brand })}
                      className="hover:text-danger"
                    >
                      <span className="hidden md:inline">Delete</span>
                    </Button>
                  ) : null}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <BrandEditor
        open={editor.open}
        brand={editor.brand}
        onClose={() => setEditor((current) => ({ ...current, open: false }))}
      />
      {canDelete ? (
        <DeleteBrandDialog
          open={deleting.open}
          brand={deleting.brand}
          onClose={() =>
            setDeleting((current) => ({ ...current, open: false }))
          }
        />
      ) : null}
    </section>
  );
}
