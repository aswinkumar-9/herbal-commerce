import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { fieldProblems, problemMessage } from '../../api/problems';
import { Button } from '../../components/Button';
import { Dialog, DialogActions } from '../../components/Dialog';
import { TextAreaField } from '../../components/Field';
import { useToasts } from '../../components/toast-context';
import { useUnsavedPart } from '../../components/unsaved-changes';
import { deleteImage, updateImage } from '../catalog-api';
import type { ProductImage } from '../catalog-api';
import { catalogKeys, dropImage, putImage } from '../catalog-queries';

// The longest description the API takes.
export const ALT_TEXT_MAX = 150;
// The API's own words for the refusal, ahead of it.
export const LAST_IMAGE =
  'A live product needs at least one image. Add another first, or take the product offline.';

const DESCRIBING = ['image-description'] as const;
const DELETING = ['image-delete'] as const;

// The description of a photo, for people who cannot see it (ADR 0023).
export function ImageDescriptionDialog({
  open,
  image,
  onClose,
}: {
  open: boolean;
  image: ProductImage | null;
  onClose: () => void;
}) {
  const saving = useIsMutating({ mutationKey: DESCRIBING }) > 0;
  return (
    <Dialog
      open={open && image !== null}
      onClose={onClose}
      locked={saving}
      size="md"
      title="Describe the image"
    >
      {image ? <DescriptionForm image={image} onDone={onClose} /> : null}
    </Dialog>
  );
}

function DescriptionForm({
  image,
  onDone,
}: {
  image: ProductImage;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [initial] = useState(image.altText ?? '');
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useUnsavedPart(text !== initial);

  const save = useMutation({
    mutationKey: DESCRIBING,
    mutationFn: (altText: string | null) => updateImage(image.id, { altText }),
    onSuccess: (saved) => {
      putImage(queryClient, saved);
      toasts.show(saved.altText ? 'Description saved' : 'Description removed');
      onDone();
    },
    onError: (failure) => {
      const marked = fieldProblems(failure).altText ?? null;
      setError(marked);
      setProblem(marked ? null : problemMessage(failure));
      if (marked) {
        box.current?.focus();
      }
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) {
      return;
    }
    // The API trims it too; empty is none.
    const altText = text.trim();
    if (altText === (image.altText ?? '')) {
      onDone();
      return;
    }
    save.mutate(altText || null);
  }

  return (
    <form noValidate onSubmit={submit} className="mt-5 space-y-5">
      {problem ? (
        <p
          role="alert"
          className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {problem}
        </p>
      ) : null}
      <img
        src={image.thumbnailUrl}
        alt=""
        draggable={false}
        className="h-32 w-auto max-w-full rounded-lg border border-line bg-surface-muted object-contain"
      />
      <TextAreaField
        ref={box}
        label="Description"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
          setProblem(null);
        }}
        rows={3}
        maxLength={ALT_TEXT_MAX}
        hint={`What the photo shows, for people who can't see it, like "The back label, with the ingredients". Left empty, the shop uses the product's name.`}
        error={error ?? undefined}
      />
      <DialogActions>
        <Button onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          busy={save.isPending}
          busyLabel="Saving…"
        >
          Save description
        </Button>
      </DialogActions>
    </form>
  );
}

// Admins and Super Users delete images (ADR 0023). A live product keeps
// at least one: then the dialog says why it cannot go, and the API refuses
// it too.
export function DeleteImageDialog({
  open,
  image,
  isMain,
  isLastOfLive,
  onClose,
}: {
  open: boolean;
  image: ProductImage | null;
  // The first image, with others after it.
  isMain: boolean;
  isLastOfLive: boolean;
  onClose: () => void;
}) {
  const busy = useIsMutating({ mutationKey: DELETING }) > 0;
  return (
    <Dialog
      open={open && image !== null}
      onClose={onClose}
      locked={busy}
      tone="danger"
      title="Delete this image?"
      description={
        <p>
          It is removed for good, from the shop too. The audit log keeps a
          record of it.
          {isMain ? ' The next image becomes the main photo.' : null}
        </p>
      }
    >
      {image ? (
        <DeleteChoices
          image={image}
          isLastOfLive={isLastOfLive}
          onDone={onClose}
        />
      ) : null}
    </Dialog>
  );
}

function DeleteChoices({
  image,
  isLastOfLive,
  onDone,
}: {
  image: ProductImage;
  isLastOfLive: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [problem, setProblem] = useState<string | null>(null);

  const remove = useMutation({
    mutationKey: DELETING,
    mutationFn: () => deleteImage(image.id),
    onSuccess: () => {
      dropImage(queryClient, image.productId, image.id);
      void queryClient.invalidateQueries({
        queryKey: catalogKeys.images(image.productId),
      });
      toasts.show('Image deleted');
      onDone();
    },
    onError: (error) => setProblem(problemMessage(error)),
  });

  return (
    <div className="mt-4 space-y-3 text-sm">
      <img
        src={image.thumbnailUrl}
        alt=""
        draggable={false}
        className="h-24 w-auto max-w-full rounded-lg border border-line bg-surface-muted object-contain"
      />
      {isLastOfLive ? (
        <p className="rounded-lg bg-surface-muted px-3 py-2">{LAST_IMAGE}</p>
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
          {isLastOfLive ? 'Close' : 'Keep it'}
        </Button>
        {isLastOfLive ? null : (
          <Button
            variant="danger"
            onClick={() => remove.mutate()}
            busy={remove.isPending}
            busyLabel="Deleting…"
          >
            Delete for good
          </Button>
        )}
      </DialogActions>
    </div>
  );
}
