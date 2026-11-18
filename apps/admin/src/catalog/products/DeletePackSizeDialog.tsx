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
import { deleteVariant, updateVariant } from '../catalog-api';
import type { Variant } from '../catalog-api';
import { catalogKeys, dropVariant, putVariant } from '../catalog-queries';
import { packName } from './pack-size-form';

const DELETING = ['pack-size-delete'] as const;

interface DeleteProps {
  open: boolean;
  variant: Variant | null;
  onClose: () => void;
}

// Super Users only (the API refuses Admins). Says what is lost, and offers
// taking the pack size off sale instead, which can be undone. A pack size
// that still has stock cannot go: the API says so.
export function DeletePackSizeDialog({ open, variant, onClose }: DeleteProps) {
  const busy = useIsMutating({ mutationKey: DELETING }) > 0;
  return (
    <Dialog
      open={open && variant !== null}
      onClose={onClose}
      locked={busy}
      tone="danger"
      title={`Delete ${variant ? packName(variant) : ''}?`}
      description={
        <p>
          It is removed for good, with its SKU and prices. The audit log keeps a
          record of it.
        </p>
      }
    >
      {variant ? <Choices variant={variant} onDone={onClose} /> : null}
    </Dialog>
  );
}

function Choices({
  variant,
  onDone,
}: {
  variant: Variant;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [problem, setProblem] = useState<string | null>(null);
  const name = packName(variant);

  const remove = useMutation({
    mutationKey: DELETING,
    mutationFn: () => deleteVariant(variant.id),
    onSuccess: () => {
      dropVariant(queryClient, variant.productId, variant.id);
      void queryClient.invalidateQueries({
        queryKey: catalogKeys.variants(variant.productId),
      });
      toasts.show(`${name} deleted`);
      onDone();
    },
    onError: (error) => setProblem(problemMessage(error)),
  });
  const offSale = useMutation({
    mutationKey: DELETING,
    mutationFn: () => updateVariant(variant.id, { isActive: false }),
    onSuccess: (saved) => {
      putVariant(queryClient, saved);
      toasts.show(`${name} is now off sale`);
      onDone();
    },
    onError: (error) => setProblem(problemMessage(error)),
  });
  const busy = remove.isPending || offSale.isPending;

  return (
    <div className="mt-4 space-y-3 text-sm">
      <p className="text-ink-muted">
        A pack size that still has stock can&apos;t be deleted: write the stock
        off first.
        {variant.isActive
          ? ' To stop selling it for now, take it off sale instead: it can go back on sale later.'
          : null}
      </p>
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
        {variant.isActive ? (
          <Button
            onClick={() => offSale.mutate()}
            busy={offSale.isPending}
            disabled={remove.isPending}
          >
            Take it off sale instead
          </Button>
        ) : null}
        <Button
          variant="danger"
          onClick={() => remove.mutate()}
          busy={remove.isPending}
          disabled={offSale.isPending}
        >
          Delete for good
        </Button>
      </DialogActions>
    </div>
  );
}
