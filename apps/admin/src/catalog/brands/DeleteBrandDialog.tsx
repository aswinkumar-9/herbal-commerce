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
import { deleteBrand, listProducts } from '../catalog-api';
import type { Brand } from '../catalog-api';
import { catalogKeys, dropBrand } from '../catalog-queries';

const DELETING = ['brand-delete'] as const;

interface DeleteProps {
  open: boolean;
  brand: Brand | null;
  onClose: () => void;
}

// Super Users only (the API refuses Admins). A brand that products still
// have can't go: they need another brand, or none, first.
export function DeleteBrandDialog({ open, brand, onClose }: DeleteProps) {
  const busy = useIsMutating({ mutationKey: DELETING }) > 0;
  return (
    <Dialog
      open={open && brand !== null}
      onClose={onClose}
      locked={busy}
      tone="danger"
      title={`Delete ${brand?.name ?? ''}?`}
      description={
        <p>
          It is removed for good from the list of brands. The audit log keeps a
          record of it.
        </p>
      }
    >
      {brand ? <Choices brand={brand} onDone={onClose} /> : null}
    </Dialog>
  );
}

function Choices({ brand, onDone }: { brand: Brand; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [problem, setProblem] = useState<string | null>(null);

  // Asked again, not taken from the list: a product may have been given
  // the brand since the list was read.
  const products = useQuery({
    queryKey: catalogKeys.brandHasProducts(brand.id),
    queryFn: ({ signal }) =>
      listProducts({ brandId: brand.id, limit: 1 }, signal),
  });
  const hasProducts = (products.data?.products.length ?? 0) > 0;

  const remove = useMutation({
    mutationKey: DELETING,
    mutationFn: () => deleteBrand(brand.id),
    onSuccess: () => {
      dropBrand(queryClient, brand.id);
      void queryClient.invalidateQueries({ queryKey: catalogKeys.brands() });
      toasts.show(`${brand.name} deleted`);
      onDone();
    },
    onError: (error) => setProblem(problemMessage(error)),
  });

  return (
    <div className="mt-4 space-y-3 text-sm">
      {products.isPending ? (
        <output className="block text-ink-muted">Checking for products…</output>
      ) : hasProducts ? (
        <p className="rounded-lg border border-line bg-surface-muted px-3 py-2">
          Products still have this brand, so it can&apos;t be deleted. Choose
          another brand for them, or none, first.
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
        <Button onClick={onDone} disabled={remove.isPending}>
          Keep it
        </Button>
        <Button
          variant="danger"
          onClick={() => remove.mutate()}
          busy={remove.isPending}
          disabled={products.isPending || hasProducts}
        >
          Delete for good
        </Button>
      </DialogActions>
    </div>
  );
}
