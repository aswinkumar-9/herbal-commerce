import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { AnimatePresence, Reorder, useDragControls } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { problemMessage } from '../../api/problems';
import { useSession } from '../../auth/session-context';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { useToasts } from '../../components/toast-context';
import { DURATION, EASE_OUT, transition } from '../../motion';
import { usePageTitle } from '../../page-title';
import { reorderCategories, updateCategory } from '../catalog-api';
import type { Category } from '../catalog-api';
import { catalogKeys, putCategory, useCategories } from '../catalog-queries';
import { inLevel, parentOf, visibilityNote } from '../category-tree';
import { EmptyList, ListLoading, LoadFailed } from '../list-states';
import { DragHandle, OrderBar, useReorder } from '../reorder';
import { CategoryEditor } from './CategoryEditor';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';

// Whether a list of subcategories has its new order on the way, or just
// saved: the bar above the page says so for every list.
interface LevelStatus {
  saving: boolean;
  savedNote: boolean;
}
type ReportStatus = (parentId: string, status: LevelStatus | null) => void;

// One level of categories in the order staff make (part 15A): the top
// categories, or the subcategories of one. The API answers a new order
// with every category, which goes in the cache; the order kept here is
// this level's.
function useLevelOrder(
  parentId: string | null,
  items: Category[] | undefined,
  listName?: string,
) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  return useReorder({
    items,
    listName,
    send: async (ids) => {
      const all = await reorderCategories(ids, parentId);
      queryClient.setQueryData(catalogKeys.categories(), all);
      return inLevel(all, parentId);
    },
    onSaved: () => undefined,
    onFailed: (error) => {
      toasts.show(problemMessage(error), 'error');
      void queryClient.invalidateQueries({
        queryKey: catalogKeys.categories(),
      });
    },
  });
}

// The groups customers browse in the shop, in the order they see them:
// each top category, with the subcategories inside it under it. Admins and
// Super Users add, change, hide and order them, one level at a time; only
// Super Users delete them.
export function CategoriesPage() {
  usePageTitle('Categories');
  const categories = useCategories();
  const all = categories.data;
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
  const edit = (category: Category | null) =>
    setEditor({ open: true, category });
  const remove = (category: Category) => setDeleting({ open: true, category });

  const order = useLevelOrder(null, all && inLevel(all, null));
  const [levels, setLevels] = useState<ReadonlyMap<string, LevelStatus>>(
    () => new Map(),
  );
  const report = useCallback<ReportStatus>((parentId, status) => {
    setLevels((current) => {
      const was = current.get(parentId);
      if (
        status?.saving === was?.saving &&
        status?.savedNote === was?.savedNote
      ) {
        return current;
      }
      const next = new Map(current);
      if (status) {
        next.set(parentId, status);
      } else {
        next.delete(parentId);
      }
      return next;
    });
  }, []);
  const saving =
    order.saving || [...levels.values()].some((level) => level.saving);
  const savedNote =
    !saving &&
    (order.savedNote || [...levels.values()].some((level) => level.savedNote));
  const hasSubcategories = all?.some((c) => c.parentId !== null) ?? false;

  return (
    <section className="max-w-4xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Categories</h1>
          <p className="mt-1 text-ink-muted">
            The groups customers browse in the shop, in the order they see them.
          </p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => edit(null)}>
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
            <Button variant="primary" icon={Plus} onClick={() => edit(null)}>
              Add the first category
            </Button>
          }
        >
          Categories are the groups customers browse in the shop. Products go
          into them.
        </EmptyList>
      ) : (
        <>
          <OrderBar
            order={{
              helpId: order.helpId,
              saving,
              savedNote,
              announcement: order.announcement,
            }}
            noun="category"
          >
            Drag a handle to change the order.
            {hasSubcategories
              ? ' A subcategory moves among the others in its category.'
              : null}
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
                <CategoryItem
                  key={category.id}
                  category={category}
                  categories={categories.data}
                  index={index}
                  helpId={order.helpId}
                  canDelete={canDelete}
                  onKeyMove={(event) => order.keyMove(category, event)}
                  onDragStart={() => order.dragStart(category)}
                  onDrop={() => order.drop(category)}
                  onEdit={() => edit(category)}
                  onDelete={() => remove(category)}
                >
                  {inLevel(categories.data, category.id).length > 0 ? (
                    <SubcategoryList
                      parent={category}
                      categories={categories.data}
                      helpId={order.helpId}
                      canDelete={canDelete}
                      onEdit={edit}
                      onDelete={remove}
                      onStatus={report}
                    />
                  ) : null}
                </CategoryItem>
              ))}
            </AnimatePresence>
          </Reorder.Group>
        </>
      )}

      <CategoryEditor
        open={editor.open}
        category={editor.category}
        categories={all ?? []}
        onClose={() => setEditor((current) => ({ ...current, open: false }))}
      />
      {canDelete ? (
        <DeleteCategoryDialog
          open={deleting.open}
          category={deleting.category}
          categories={all ?? []}
          onClose={() =>
            setDeleting((current) => ({ ...current, open: false }))
          }
        />
      ) : null}
    </section>
  );
}

// The subcategories of one top category, under it, in their own order:
// they move only among themselves.
function SubcategoryList({
  parent,
  categories,
  helpId,
  canDelete,
  onEdit,
  onDelete,
  onStatus,
}: {
  parent: Category;
  categories: Category[];
  // The help above the page's list, which says how to move rows.
  helpId: string;
  canDelete: boolean;
  onEdit: (category: Category) => void;
  onDelete: (category: Category) => void;
  onStatus: ReportStatus;
}) {
  const level = useLevelOrder(
    parent.id,
    inLevel(categories, parent.id),
    parent.name,
  );
  const { saving, savedNote } = level;
  useEffect(() => {
    onStatus(parent.id, { saving, savedNote });
  }, [onStatus, parent.id, saving, savedNote]);
  useEffect(() => () => onStatus(parent.id, null), [onStatus, parent.id]);

  return (
    <>
      <Reorder.Group
        as="ol"
        axis="y"
        values={level.rowIds}
        onReorder={level.arrange}
        aria-label={`Subcategories of ${parent.name}, in order`}
        className="mt-2 ml-6 space-y-2 sm:ml-12"
      >
        <AnimatePresence initial={false}>
          {level.rows.map((category, index) => (
            <CategoryItem
              key={category.id}
              category={category}
              categories={categories}
              index={index}
              helpId={helpId}
              canDelete={canDelete}
              onKeyMove={(event) => level.keyMove(category, event)}
              onDragStart={() => level.dragStart(category)}
              onDrop={() => level.drop(category)}
              onEdit={() => onEdit(category)}
              onDelete={() => onDelete(category)}
            />
          ))}
        </AnimatePresence>
      </Reorder.Group>
      <p className="sr-only" aria-live="assertive">
        {level.announcement}
      </p>
    </>
  );
}

interface ItemProps {
  category: Category;
  // Every category, to find the one it sits in.
  categories: Category[];
  index: number;
  helpId: string;
  canDelete: boolean;
  onKeyMove: (event: KeyboardEvent) => void;
  onDragStart: () => void;
  onDrop: () => void;
  onEdit: () => void;
  onDelete: () => void;
  // A top category's subcategories, which move with it.
  children?: ReactNode;
}

function CategoryItem({
  category,
  categories,
  index,
  helpId,
  canDelete,
  onKeyMove,
  onDragStart,
  onDrop,
  onEdit,
  onDelete,
  children,
}: ItemProps) {
  const controls = useDragControls();
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const parent = parentOf(categories, category);

  // Shown or hidden at once; the switch shows the new state while saving.
  const visibility = useMutation({
    mutationFn: (isActive: boolean) =>
      updateCategory(category.id, { isActive }),
    onSuccess: (saved) => {
      putCategory(queryClient, saved);
      toasts.show(visibilityNote(categories, saved));
    },
    onError: (error) => toasts.show(problemMessage(error), 'error'),
  });
  const on = visibility.isPending ? visibility.variables : category.isActive;
  // A subcategory is hidden while its top category is.
  const shown = on && (parent?.isActive ?? true);

  return (
    <Reorder.Item
      as="li"
      value={category.id}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDrop}
      layout="position"
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
      className="rounded-card"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-surface p-3 shadow-clay-sm inset-shadow-clay sm:flex-nowrap">
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
          {on && parent && !parent.isActive ? (
            <p className="mt-1 text-sm text-ink-muted">
              Customers see it once {parent.name} is shown.
            </p>
          ) : null}
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
            checked={on}
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
      </div>
      {children}
    </Reorder.Item>
  );
}
