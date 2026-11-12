import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  FolderPlus,
  GripVertical,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  AnimatePresence,
  Reorder,
  motion,
  useDragControls,
} from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
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
import { useSavedOrder } from '../use-saved-order';
import { CategoryEditor } from './CategoryEditor';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';

// How long "Order saved" stays.
const SAVED_NOTE_MS = 2500;
const MAX_POSITION = 9999;

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
  const [announcement, setAnnouncement] = useState('');
  const [savedNote, setSavedNote] = useState(false);

  const order = useSavedOrder({
    items: categories.data,
    send: reorderCategories,
    onSaved: (saved) => {
      queryClient.setQueryData(catalogKeys.categories(), saved);
      setSavedNote(true);
    },
    onFailed: (error) => {
      toasts.show(problemMessage(error), 'error');
      void queryClient.invalidateQueries({
        queryKey: catalogKeys.categories(),
      });
    },
  });

  useEffect(() => {
    if (!savedNote) {
      return;
    }
    const timer = setTimeout(() => setSavedNote(false), SAVED_NOTE_MS);
    return () => clearTimeout(timer);
  }, [savedNote]);

  const byId = new Map(categories.data?.map((c) => [c.id, c]));
  const rows = order.ids.flatMap((id) => {
    const category = byId.get(id);
    return category ? [category] : [];
  });
  const rowIds = rows.map((category) => category.id);

  // Read when a drag ends, after the last move has drawn.
  const shownIds = useRef(rowIds);
  useEffect(() => {
    shownIds.current = rowIds;
  });
  const dragFrom = useRef<number | null>(null);
  const helpId = useId();

  function announceMove(category: Category, ids: string[]) {
    const at = ids.indexOf(category.id) + 1;
    setAnnouncement(
      `${category.name} moved to position ${at} of ${ids.length}.`,
    );
  }

  // Up and Down move a category one place, Home and End to the top or the
  // bottom. The handle keeps the focus as its row moves: React puts it back
  // after moving the row in the page.
  function moveWithKeys(category: Category, event: KeyboardEvent) {
    const from = rowIds.indexOf(category.id);
    const last = rowIds.length - 1;
    const to =
      event.key === 'ArrowUp'
        ? from - 1
        : event.key === 'ArrowDown'
          ? from + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (to === null) {
      return;
    }
    event.preventDefault();
    if (to < 0 || to > last || to === from) {
      return;
    }
    const next = [...rowIds];
    next.splice(from, 1);
    next.splice(to, 0, category.id);
    order.save(next);
    announceMove(category, next);
  }

  function dropped(category: Category) {
    const ids = shownIds.current;
    if (dragFrom.current !== ids.indexOf(category.id)) {
      announceMove(category, ids);
    }
    dragFrom.current = null;
    order.save(ids);
  }

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
        <Loading />
      ) : categories.isError ? (
        <LoadFailed
          message={problemMessage(categories.error)}
          retrying={categories.isFetching}
          onRetry={() => void categories.refetch()}
        />
      ) : rows.length === 0 ? (
        <Empty onAdd={() => setEditor({ open: true, category: null })} />
      ) : (
        <>
          <div className="mt-8 flex min-h-6 flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
            <p id={helpId}>
              Drag a handle to change the order.
              <span className="sr-only">
                {' '}
                Or press Up or Down to move a category one place, Home or End to
                move it to the top or the bottom.
              </span>
            </p>
            {/* Read out as it changes. */}
            <output className="flex items-center gap-1.5">
              <AnimatePresence mode="wait" initial={false}>
                {order.saving ? (
                  <motion.span
                    key="saving"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    Saving the order…
                  </motion.span>
                ) : savedNote ? (
                  <motion.span
                    key="saved"
                    initial={{ opacity: 0, y: 2 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-1.5 text-primary"
                  >
                    <Check aria-hidden="true" className="size-4" />
                    Order saved
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </output>
          </div>
          <p className="sr-only" aria-live="assertive">
            {announcement}
          </p>
          <Reorder.Group
            as="ol"
            axis="y"
            values={rowIds}
            onReorder={order.arrange}
            aria-label="Categories, in the order customers see them"
            className="mt-3 space-y-2"
          >
            <AnimatePresence initial={false}>
              {rows.map((category, index) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  index={index}
                  helpId={helpId}
                  canDelete={canDelete}
                  onKeyMove={(event) => moveWithKeys(category, event)}
                  onDragStart={() => {
                    dragFrom.current = rowIds.indexOf(category.id);
                  }}
                  onDrop={() => dropped(category)}
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
      <button
        type="button"
        aria-label={`Move ${category.name}`}
        aria-describedby={helpId}
        onPointerDown={(event) => controls.start(event)}
        onKeyDown={onKeyMove}
        className="grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-ink-muted hover:bg-surface-muted hover:text-ink active:cursor-grabbing"
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>

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

function Loading() {
  return (
    <div className="mt-8">
      <output className="sr-only">Loading the categories…</output>
      <ul aria-hidden="true" className="space-y-2">
        {[0, 1, 2, 3].map((row) => (
          <li
            key={row}
            className="h-16 animate-pulse rounded-card bg-surface-muted"
          />
        ))}
      </ul>
    </div>
  );
}

function LoadFailed({
  message,
  retrying,
  onRetry,
}: {
  message: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mt-8 rounded-card border border-line bg-surface p-6 text-center"
    >
      <p className="font-medium">The categories could not be loaded</p>
      <p className="mt-1 text-sm text-ink-muted">{message}</p>
      <Button
        icon={RefreshCw}
        onClick={onRetry}
        busy={retrying}
        className="mt-4"
      >
        Try again
      </Button>
    </div>
  );
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mt-8 flex flex-col items-center rounded-card border border-dashed border-line bg-surface p-10 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
        <FolderPlus aria-hidden="true" className="size-6" />
      </span>
      <p className="mt-4 font-medium">No categories yet</p>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">
        Categories are the groups customers browse in the shop. Products go into
        them.
      </p>
      <Button variant="primary" icon={Plus} onClick={onAdd} className="mt-5">
        Add the first category
      </Button>
    </div>
  );
}
