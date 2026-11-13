import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { problemMessage } from '../../api/problems';
import { Button } from '../../components/Button';
import { Dialog, DialogActions } from '../../components/Dialog';
import { useToasts } from '../../components/toast-context';
import { deleteProduct, updateProduct } from '../catalog-api';
import type { Product } from '../catalog-api';
import { catalogKeys } from '../catalog-queries';

const DELETING = ['product-delete'] as const;

interface DeleteProps {
  open: boolean;
  product: Product;
  onClose: () => void;
  onDeleted: () => void;
  // Hidden instead: the page shows it as a draft again.
  onHidden: () => void;
}

// Super Users only (the API refuses Admins). Says what is lost, and offers
// hiding a live product instead, which can be undone. A product that still
// has stock is refused by the API, which says why.
export function DeleteProductDialog({
  open,
  product,
  onClose,
  onDeleted,
  onHidden,
}: DeleteProps) {
  const busy = useIsMutating({ mutationKey: DELETING }) > 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      locked={busy}
      tone="danger"
      title={`Delete ${product.name}?`}
      description={
        <p>
          It is removed for good, with its pack sizes and images: customers can
          no longer find it, and its web address stops working. The audit log
          keeps a record of it.
        </p>
      }
    >
      <Choices
        product={product}
        onClose={onClose}
        onDeleted={onDeleted}
        onHidden={onHidden}
      />
    </Dialog>
  );
}

function Choices({
  product,
  onClose,
  onDeleted,
  onHidden,
}: Omit<DeleteProps, 'open'>) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [problem, setProblem] = useState<string | null>(null);

  const remove = useMutation({
    mutationKey: DELETING,
    mutationFn: () => deleteProduct(product.id),
    onSuccess: () => {
      // The lists forget it at once, so it never shows there again.
      queryClient.removeQueries({ queryKey: catalogKeys.productLists() });
      toasts.show(`${product.name} deleted`);
      onDeleted();
    },
    onError: (error) => setProblem(problemMessage(error)),
  });
  const hide = useMutation({
    mutationKey: DELETING,
    mutationFn: () => updateProduct(product.id, { isActive: false }),
    onSuccess: (saved) => {
      queryClient.setQueryData(catalogKeys.product(saved.id), saved);
      toasts.show(`${saved.name} is now hidden from customers`);
      onHidden();
      onClose();
    },
    onError: (error) => setProblem(problemMessage(error)),
  });
  const busy = remove.isPending || hide.isPending;

  return (
    <div className="mt-4 space-y-3 text-sm">
      {product.isActive ? (
        <p className="text-ink-muted">
          To take it out of the shop for now, hide it instead: it keeps its
          details, pack sizes and images, and can be shown again.
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
        <Button onClick={onClose} disabled={busy}>
          Keep it
        </Button>
        {product.isActive ? (
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
          disabled={hide.isPending}
        >
          Delete for good
        </Button>
      </DialogActions>
    </div>
  );
}
