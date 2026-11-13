import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  AnimatePresence,
  Reorder,
  motion,
  useDragControls,
} from 'motion/react';
import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { problemMessage } from '../../api/problems';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { useToasts } from '../../components/toast-context';
import { DURATION, EASE_OUT, rise, transition } from '../../motion';
import { MAX_POSITION, reorderVariants, updateVariant } from '../catalog-api';
import type { Product, Variant } from '../catalog-api';
import { catalogKeys, putVariant, useVariants } from '../catalog-queries';
import { LoadFailed } from '../list-states';
import { DragHandle, OrderBar, useReorder } from '../reorder';
import { DeletePackSizeDialog } from './DeletePackSizeDialog';
import { PackSizeEditor } from './PackSizeEditor';
import { packName, rupees } from './pack-size-form';

// A pack size with the name the screen gives it, for ordering.
type PackRow = Variant & { name: string };

function named(variant: Variant): PackRow {
  return { ...variant, name: packName(variant) };
}

// Back to the pack size as the server sent it, for the cache.
function unnamed(row: PackRow): Variant {
  const variant: Partial<PackRow> = { ...row };
  delete variant.name;
  return variant as Variant;
}

// The sizes customers can buy, with their prices, in the order the shop
// shows them (ADR 0022, 0033). Each change is saved on its own, apart from
// the product's details. Only Super Users delete them.
export function PackSizesSection({
  product,
  canDelete,
}: {
  product: Product;
  canDelete: boolean;
}) {
  const titleId = useId();
  const variants = useVariants(product.id);
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [editor, setEditor] = useState<{
    open: boolean;
    variant: Variant | null;
  }>({ open: false, variant: null });
  const [deleting, setDeleting] = useState<{
    open: boolean;
    variant: Variant | null;
  }>({ open: false, variant: null });

  const rows = useMemo(() => variants.data?.map(named), [variants.data]);
  const order = useReorder({
    items: rows,
    send: async (ids) =>
      (await reorderVariants(product.id, ids)).map((variant) => named(variant)),
    onSaved: (saved) => {
      queryClient.setQueryData(
        catalogKeys.variants(product.id),
        saved.map(unnamed),
      );
    },
    onFailed: (error) => {
      toasts.show(problemMessage(error), 'error');
      void queryClient.invalidateQueries({
        queryKey: catalogKeys.variants(product.id),
      });
    },
  });

  const nextPosition = Math.min(
    MAX_POSITION,
    Math.max(-1, ...(variants.data ?? []).map((v) => v.position)) + 1,
  );
  const add = () => setEditor({ open: true, variant: null });
  const nothingOnSale =
    product.isActive &&
    variants.data !== undefined &&
    !variants.data.some((variant) => variant.isActive);

  return (
    <motion.section
      variants={rise}
      initial="hidden"
      animate="shown"
      aria-labelledby={titleId}
      className="mt-6 rounded-card border border-line bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="font-semibold">
            Pack sizes
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            The sizes customers can buy, with their prices, in the order the
            shop shows them.
          </p>
        </div>
        {order.rows.length > 0 ? (
          <Button size="sm" icon={Plus} onClick={add}>
            Add pack size
          </Button>
        ) : null}
      </div>

      {variants.isPending ? (
        <div className="mt-5">
          <output className="sr-only">Loading the pack sizes…</output>
          <ul aria-hidden="true" className="space-y-2">
            {[0, 1].map((row) => (
              <li
                key={row}
                className="h-16 animate-pulse rounded-lg bg-surface-muted"
              />
            ))}
          </ul>
        </div>
      ) : variants.isError ? (
        <LoadFailed
          title="The pack sizes could not be loaded"
          message={problemMessage(variants.error)}
          retrying={variants.isFetching}
          onRetry={() => void variants.refetch()}
        />
      ) : order.rows.length === 0 ? (
        <div className="mt-5 flex flex-col items-center rounded-lg border border-dashed border-line p-6 text-center">
          <span className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary">
            <Package aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-3 font-medium">No pack sizes yet</p>
          <p className="mt-1 max-w-sm text-sm text-ink-muted">
            Customers buy a product by its pack size, such as 100 ml or 60
            capsules.
          </p>
          <Button variant="primary" icon={Plus} onClick={add} className="mt-4">
            Add the first pack size
          </Button>
        </div>
      ) : (
        <>
          {nothingOnSale ? (
            <p className="mt-4 rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm">
              The product is live, but no pack size is on sale: customers
              can&apos;t buy it.
            </p>
          ) : null}
          <OrderBar order={order} noun="pack size" className="mt-4">
            Drag a handle to change the order.
          </OrderBar>
          <Reorder.Group
            as="ol"
            axis="y"
            values={order.rowIds}
            onReorder={order.arrange}
            aria-label="Pack sizes, in the order customers see them"
            className="mt-3 space-y-2"
          >
            <AnimatePresence initial={false}>
              {order.rows.map((row, index) => (
                <PackRowItem
                  key={row.id}
                  row={row}
                  index={index}
                  helpId={order.helpId}
                  canDelete={canDelete}
                  onKeyMove={(event) => order.keyMove(row, event)}
                  onDragStart={() => order.dragStart(row)}
                  onDrop={() => order.drop(row)}
                  onEdit={() =>
                    setEditor({ open: true, variant: unnamed(row) })
                  }
                  onDelete={() =>
                    setDeleting({ open: true, variant: unnamed(row) })
                  }
                />
              ))}
            </AnimatePresence>
          </Reorder.Group>
        </>
      )}

      <PackSizeEditor
        open={editor.open}
        productId={product.id}
        variant={editor.variant}
        nextPosition={nextPosition}
        onClose={() => setEditor((current) => ({ ...current, open: false }))}
      />
      {canDelete ? (
        <DeletePackSizeDialog
          open={deleting.open}
          variant={deleting.variant}
          onClose={() =>
            setDeleting((current) => ({ ...current, open: false }))
          }
        />
      ) : null}
    </motion.section>
  );
}

interface RowProps {
  row: PackRow;
  index: number;
  helpId: string;
  canDelete: boolean;
  onKeyMove: (event: KeyboardEvent) => void;
  onDragStart: () => void;
  onDrop: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function PackRowItem({
  row,
  index,
  helpId,
  canDelete,
  onKeyMove,
  onDragStart,
  onDrop,
  onEdit,
  onDelete,
}: RowProps) {
  const controls = useDragControls();
  const queryClient = useQueryClient();
  const toasts = useToasts();

  // On or off sale at once; the switch shows the new state while saving.
  const sale = useMutation({
    mutationFn: (isActive: boolean) => updateVariant(row.id, { isActive }),
    onSuccess: (saved) => {
      putVariant(queryClient, saved);
      toasts.show(
        saved.isActive
          ? `${row.name} is now on sale`
          : `${row.name} is now off sale`,
      );
    },
    onError: (error) => toasts.show(problemMessage(error), 'error'),
  });
  const onSale = sale.isPending ? sale.variables : row.isActive;

  return (
    <Reorder.Item
      as="li"
      value={row.id}
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
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface p-3 sm:flex-nowrap"
    >
      <DragHandle
        label={`Move ${row.name}`}
        helpId={helpId}
        controls={controls}
        onKeyDown={onKeyMove}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{row.name}</p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              onSale
                ? 'bg-primary-soft text-primary-strong'
                : 'bg-surface-muted text-ink-muted'
            }`}
          >
            {onSale ? 'On sale' : 'Off sale'}
          </span>
        </div>
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-ink-muted">
          <span className="font-mono text-xs leading-5">{row.sku}</span>
          <span>
            <span className="font-medium text-ink">
              {rupees(row.priceRupees)}
            </span>
            {row.priceRupees < row.mrpRupees ? (
              <span> · MRP {rupees(row.mrpRupees)}</span>
            ) : (
              <span> (the MRP)</span>
            )}
          </span>
        </p>
      </div>

      <div className="ml-12 flex items-center gap-1 sm:ml-0">
        <Switch
          label={`${row.name} on sale`}
          hideLabel
          checked={onSale}
          busy={sale.isPending}
          onChange={(isActive) => sale.mutate(isActive)}
          className="mr-2"
        />
        <Button
          variant="ghost"
          size="sm"
          icon={Pencil}
          aria-label={`Edit ${row.name}`}
          onClick={onEdit}
        >
          Edit
        </Button>
        {canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            aria-label={`Delete ${row.name}`}
            onClick={onDelete}
            className="hover:text-danger"
          >
            <span className="hidden md:inline">Delete</span>
          </Button>
        ) : null}
      </div>
    </Reorder.Item>
  );
}
