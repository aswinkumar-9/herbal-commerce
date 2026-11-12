import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { problemMessage } from '../../api/problems';
import { Button } from '../../components/Button';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useToasts } from '../../components/toast-context';
import { deleteCategory, listProducts, updateCategory } from '../catalog-api';
import type { Category } from '../catalog-api';
import { catalogKeys, dropCategory, putCategory } from '../catalog-queries';

const DELETING = ['category-delete'] as const;

interface DeleteProps {
  open: boolean;
  category: Category | null;
  onClose: () => void;
}

// Super Users only (the API refuses Admins). Says what is lost, and offers
// hiding the category instead, which can be undone.
export function DeleteCategoryDialog({ open, category, onClose }: DeleteProps) {
  const busy = useIsMutating({ mutationKey: DELETING }) > 0;
  return (
    <Dialog
      open={open && category !== null}
      onClose={onClose}
      locked={busy}
      tone="danger"
      title={`Delete ${category?.name ?? ''}?`}
      description={
        <p>
          It is removed for good: customers can no longer find it, and its web
          address stops working. The audit log keeps a record of it.
        </p>
      }
    >
      {category ? <Choices category={category} onDone={onClose} /> : null}
    </Dialog>
  );
}

function Choices({
  category,
  onDone,
}: {
  category: Category;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [problem, setProblem] = useState<string | null>(null);

  // A category with products cannot go (the API says so too): find out
  // before staff press Delete.
  const products = useQuery({
    queryKey: catalogKeys.categoryHasProducts(category.id),
    queryFn: ({ signal }) =>
      listProducts({ categoryId: category.id, limit: 1 }, signal),
  });
  const hasProducts = (products.data?.products.length ?? 0) > 0;

  const remove = useMutation({
    mutationKey: DELETING,
    mutationFn: () => deleteCategory(category.id),
    onSuccess: () => {
      dropCategory(queryClient, category.id);
      void queryClient.invalidateQueries({
        queryKey: catalogKeys.categories(),
      });
      toasts.show(`${category.name} deleted`);
      onDone();
    },
    onError: (error) => setProblem(problemMessage(error)),
  });
  const hide = useMutation({
    mutationKey: DELETING,
    mutationFn: () => updateCategory(category.id, { isActive: false }),
    onSuccess: (saved) => {
      putCategory(queryClient, saved);
      toasts.show(`${saved.name} is now hidden from customers`);
      onDone();
    },
    onError: (error) => setProblem(problemMessage(error)),
  });
  const busy = remove.isPending || hide.isPending;

  return (
    <div className="mt-4 space-y-3 text-sm">
      {products.isPending ? (
        <output className="block text-ink-muted">Checking for products…</output>
      ) : hasProducts ? (
        <p className="rounded-lg border border-line bg-surface-muted px-3 py-2">
          It still has products, so it can&apos;t be deleted. Move them to
          another category or delete them first.
        </p>
      ) : null}
      {category.isActive ? (
        <p className="text-ink-muted">
          To take it out of the shop for now, hide it instead: it keeps its
          products and its web address, and can be shown again.
        </p>
      ) : null}
      {problem ? (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2 text-danger"
        >
          {problem}
        </p>
      ) : null}
      <DialogActions>
        <Button onClick={onDone} disabled={busy}>
          Keep it
        </Button>
        {category.isActive ? (
          <Button
            onClick={() => hide.mutate()}
            busy={hide.isPending}
            disabled={remove.isPending}
          >
            Hide it instead
          </Button>
        ) : null}
        <Button
          variant="danger"
          onClick={() => remove.mutate()}
          busy={remove.isPending}
          disabled={hide.isPending || products.isPending || hasProducts}
        >
          Delete for good
        </Button>
      </DialogActions>
    </div>
  );
}
