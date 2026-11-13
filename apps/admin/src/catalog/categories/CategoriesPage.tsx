import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { AnimatePresence, Reorder, useDragControls } from 'motion/react';
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { problemMessage } from '../../api/problems';
import { useSession } from '../../auth/session-context';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { useToasts } from '../../components/toast-context';
import { DURATION, EASE_OUT, transition } from '../../motion';
import { usePageTitle } from '../../page-title';
import {
  MAX_POSITION,
  reorderCategories,
  updateCategory,
} from '../catalog-api';
import type { Category } from '../catalog-api';
import { catalogKeys, putCategory, useCategories } from '../catalog-queries';
import { EmptyList, ListLoading, LoadFailed } from '../list-states';
import { DragHandle, OrderBar, useReorder } from '../reorder';
import { CategoryEditor } from './CategoryEditor';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';

// The groups customers browse in the shop, in the order they see them.
// Admins and Super Users add, change, hide and order them; only Super Users
// delete them.
export function CategoriesPage() {
  usePageTitle('Categories');
  const categories = useCategories();
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const { state } = useSession();
  const canDelete =
    state.status === 'signed-in' && state.staff.role === 'SUPER_USER';

  const [editor, setEditor] = useState<{
    open: boolean;
    category: Category | null;
  }>({ open: false, category: null });
  const [deleting, setDeleting] = useState<{
    open: boolean;
    category: Category | null;
  }>({ open: false, category: null });

  const order = useReorder({
    items: categories.data,
    send: reorderCategories,
    onSaved: (saved) => {
      queryClient.setQueryData(catalogKeys.categories(), saved);
    },
    onFailed: (error) => {
      toasts.show(problemMessage(error), 'error');
      void queryClient.invalidateQueries({
        queryKey: catalogKeys.categories(),
      });
    },
  });

  const nextPosition = Math.min(
    MAX_POSITION,
    Math.max(-1, ...(categories.data ?? []).map((c) => c.position)) + 1,
  );

  return (
    <section className="max-w-4xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Categories</h1>
          <p className="mt-1 text-ink-muted">
            The groups customers browse in the shop, in the order they see them.
          </p>
        </div>
        <Button
          variant="primary"
          icon={Plus}
          onClick={() => setEditor({ open: true, category: null })}
        >
          New category
        </Button>
      </header>

      {categories.isPending ? (
        <ListLoading label="Loading the categories…" />
      ) : categories.isError ? (
        <LoadFailed
          title="The categories could not be loaded"
          message={problemMessage(categories.error)}
          retrying={categories.isFetching}
          onRetry={() => void categories.refetch()}
        />
      ) : order.rows.length === 0 ? (
        <EmptyList
          icon={FolderPlus}
          title="No categories yet"
          action={
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => setEditor({ open: true, category: null })}
            >
              Add the first category
            </Button>
          }
        >
          Categories are the groups customers browse in the shop. Products go
          into them.
        </EmptyList>
      ) : (
        <>
          <OrderBar order={order} noun="category">
            Drag a handle to change the order.
          </OrderBar>
          <Reorder.Group
            as="ol"
            axis="y"
            values={order.rowIds}
            onReorder={order.arrange}
            aria-label="Categories, in the order customers see them"
            className="mt-3 space-y-2"
          >
            <AnimatePresence initial={false}>
              {order.rows.map((category, index) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  index={index}
                  helpId={order.helpId}
                  canDelete={canDelete}
                  onKeyMove={(event) => order.keyMove(category, event)}
                  onDragStart={() => order.dragStart(category)}
                  onDrop={() => order.drop(category)}
                  onEdit={() => setEditor({ open: true, category })}
                  onDelete={() => setDeleting({ open: true, category })}
                />
              ))}
            </AnimatePresence>
          </Reorder.Group>
        </>
      )}

      <CategoryEditor
        open={editor.open}
        category={editor.category}
        nextPosition={nextPosition}
        onClose={() => setEditor((current) => ({ ...current, open: false }))}
      />
      {canDelete ? (
        <DeleteCategoryDialog
          open={deleting.open}
          category={deleting.category}
          onClose={() =>
            setDeleting((current) => ({ ...current, open: false }))
          }
        />
      ) : null}
    </section>
  );
}

interface RowProps {
  category: Category;
  index: number;
  helpId: string;
  canDelete: boolean;
  onKeyMove: (event: KeyboardEvent) => void;
  onDragStart: () => void;
  onDrop: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function CategoryRow({
  category,
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

  // Shown or hidden at once; the switch shows the new state while saving.
  const visibility = useMutation({
    mutationFn: (isActive: boolean) =>
      updateCategory(category.id, { isActive }),
    onSuccess: (saved) => {
      putCategory(queryClient, saved);
      toasts.show(
        saved.isActive
          ? `${saved.name} is now shown to customers`
          : `${saved.name} is now hidden from customers`,
      );
    },
    onError: (error) => toasts.show(problemMessage(error), 'error'),
  });
  const shown = visibility.isPending ? visibility.variables : category.isActive;

  return (
    <Reorder.Item
      as="li"
      value={category.id}
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
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-surface p-3 sm:flex-nowrap"
    >
      <DragHandle
        label={`Move ${category.name}`}
        helpId={helpId}
        controls={controls}
        onKeyDown={onKeyMove}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{category.name}</p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              shown
                ? 'bg-primary-soft text-primary-strong'
                : 'bg-surface-muted text-ink-muted'
            }`}
          >
            {shown ? 'Shown' : 'Hidden'}
          </span>
        </div>
        <p className="truncate font-mono text-xs text-ink-muted">
          /{category.slug}
        </p>
        {category.description ? (
          <p className="mt-1 line-clamp-1 text-sm text-ink-muted">
            {category.description}
          </p>
        ) : null}
      </div>

      <div className="ml-12 flex items-center gap-1 sm:ml-0">
        <Switch
          label={`Customers see ${category.name}`}
          hideLabel
          checked={shown}
          busy={visibility.isPending}
          onChange={(isActive) => visibility.mutate(isActive)}
          className="mr-2"
        />
        <Button
          variant="ghost"
          size="sm"
          icon={Pencil}
          aria-label={`Edit ${category.name}`}
          onClick={onEdit}
        >
          Edit
        </Button>
        {canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            aria-label={`Delete ${category.name}`}
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
