import { useQueryClient } from '@tanstack/react-query';
import {
  ImageIcon,
  ImagePlus,
  Pencil,
  RefreshCw,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  AnimatePresence,
  Reorder,
  motion,
  useDragControls,
} from 'motion/react';
import { useId, useMemo, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import { problemMessage } from '../../api/problems';
import { Button, buttonClass } from '../../components/Button';
import { useToasts } from '../../components/toast-context';
import { useUnsavedPart } from '../../components/unsaved-changes';
import { DURATION, EASE_OUT, rise, transition } from '../../motion';
import { IMAGE_TYPES, MAX_IMAGES, reorderImages } from '../catalog-api';
import type { Product, ProductImage } from '../catalog-api';
import { catalogKeys, useImages } from '../catalog-queries';
import { LoadFailed } from '../list-states';
import { DragHandle, OrderBar, useReorder } from '../reorder';
import { DeleteImageDialog, ImageDescriptionDialog } from './ImageDialogs';
import { fileSize, room, useImageUploads } from './image-uploads';
import type { Upload } from './image-uploads';

// An image with the name the screen gives it, for ordering: its
// description, or its place in the order the images were added, which
// stays as they move.
type ImageRow = ProductImage & { name: string };

function nameImages(images: ProductImage[]): ImageRow[] {
  const byAge = [...images].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const added = new Map(byAge.map((image, index) => [image.id, index + 1]));
  return images.map((image) => ({
    ...image,
    name: image.altText ?? `Image ${added.get(image.id) ?? 0}`,
  }));
}

// Back to the image as the server sent it, for the cache.
function unnamed(row: ImageRow): ProductImage {
  const image: Partial<ImageRow> = { ...row };
  delete image.name;
  return image as ProductImage;
}

// The photos of a product, the main one first (ADR 0023, 0033). Staff add
// several at once, chosen or dropped; each is sent on its own, with its
// progress, and can be cancelled or tried again. Admins delete them too.
export function ImagesSection({ product }: { product: Product }) {
  const titleId = useId();
  const images = useImages(product.id);
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const saved = images.data?.length ?? 0;
  const uploads = useImageUploads(product.id, saved);
  // Leaving the page would stop them.
  useUnsavedPart(
    uploads.uploads.some(
      (upload) => upload.state === 'waiting' || upload.state === 'sending',
    ),
  );
  const [describing, setDescribing] = useState<{
    open: boolean;
    image: ProductImage | null;
  }>({ open: false, image: null });
  const [deleting, setDeleting] = useState<{
    open: boolean;
    image: ProductImage | null;
  }>({ open: false, image: null });

  const rows = useMemo(
    () => (images.data ? nameImages(images.data) : undefined),
    [images.data],
  );
  const order = useReorder({
    items: rows,
    send: async (ids) => nameImages(await reorderImages(product.id, ids)),
    onSaved: (saved) => {
      queryClient.setQueryData(
        catalogKeys.images(product.id),
        saved.map(unnamed),
      );
    },
    onFailed: (error) => {
      toasts.show(problemMessage(error), 'error');
      void queryClient.invalidateQueries({
        queryKey: catalogKeys.images(product.id),
      });
    },
  });

  const left = room(saved, uploads.uploads);
  const deletingFirst =
    deleting.image !== null && order.rowIds[0] === deleting.image.id;

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
            Images
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            The photos customers see, the main one first. At most {MAX_IMAGES}.
          </p>
        </div>
        {images.data ? (
          <p className="text-sm text-ink-muted">
            {saved} of {MAX_IMAGES}
          </p>
        ) : null}
      </div>

      {images.isPending ? (
        <div className="mt-5">
          <output className="sr-only">Loading the images…</output>
          <ul aria-hidden="true" className="space-y-2">
            {[0, 1].map((row) => (
              <li
                key={row}
                className="h-20 animate-pulse rounded-lg bg-surface-muted"
              />
            ))}
          </ul>
        </div>
      ) : images.isError ? (
        <LoadFailed
          title="The images could not be loaded"
          message={problemMessage(images.error)}
          retrying={images.isFetching}
          onRetry={() => void images.refetch()}
        />
      ) : (
        <>
          {order.rows.length > 0 ? (
            <>
              <OrderBar order={order} noun="image" className="mt-4">
                Drag a handle to change the order. The first is the main photo.
              </OrderBar>
              <Reorder.Group
                as="ol"
                axis="y"
                values={order.rowIds}
                onReorder={order.arrange}
                aria-label="Images, the main photo first"
                className="mt-3 space-y-2"
              >
                <AnimatePresence initial={false}>
                  {order.rows.map((row, index) => (
                    <ImageRowItem
                      key={row.id}
                      row={row}
                      index={index}
                      helpId={order.helpId}
                      onKeyMove={(event) => order.keyMove(row, event)}
                      onDragStart={() => order.dragStart(row)}
                      onDrop={() => order.drop(row)}
                      onDescribe={() =>
                        setDescribing({ open: true, image: unnamed(row) })
                      }
                      onDelete={() =>
                        setDeleting({ open: true, image: unnamed(row) })
                      }
                    />
                  ))}
                </AnimatePresence>
              </Reorder.Group>
            </>
          ) : null}

          {uploads.uploads.length > 0 ? (
            <ul aria-label="Files being added" className="mt-4 space-y-2">
              <AnimatePresence initial={false}>
                {uploads.uploads.map((upload) => (
                  <UploadRow
                    key={upload.key}
                    upload={upload}
                    onRetry={() => uploads.retry(upload.key)}
                    onRemove={() => uploads.remove(upload.key)}
                  />
                ))}
              </AnimatePresence>
            </ul>
          ) : null}

          {left > 0 ? (
            <DropZone
              empty={saved === 0 && uploads.uploads.length === 0}
              left={left}
              onFiles={uploads.add}
            />
          ) : (
            <p className="mt-4 rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm">
              {saved >= MAX_IMAGES
                ? `The product has ${MAX_IMAGES} images, the most it can have. Delete one to add another.`
                : `The files on their way fill the last places: a product has at most ${MAX_IMAGES} images.`}
            </p>
          )}
        </>
      )}
      <p className="sr-only" aria-live="polite">
        {uploads.announcement}
      </p>

      <ImageDescriptionDialog
        open={describing.open}
        image={describing.image}
        onClose={() =>
          setDescribing((current) => ({ ...current, open: false }))
        }
      />
      <DeleteImageDialog
        open={deleting.open}
        image={deleting.image}
        isMain={deletingFirst && saved > 1}
        isLastOfLive={product.isActive && saved <= 1}
        onClose={() => setDeleting((current) => ({ ...current, open: false }))}
      />
    </motion.section>
  );
}

interface RowProps {
  row: ImageRow;
  index: number;
  helpId: string;
  onKeyMove: (event: KeyboardEvent) => void;
  onDragStart: () => void;
  onDrop: () => void;
  onDescribe: () => void;
  onDelete: () => void;
}

function ImageRowItem({
  row,
  index,
  helpId,
  onKeyMove,
  onDragStart,
  onDrop,
  onDescribe,
  onDelete,
}: RowProps) {
  const controls = useDragControls();
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
      {/* Its description is beside it, so the picture itself is not read
          out. It cannot be dragged away as a file. */}
      <img
        src={row.thumbnailUrl}
        alt=""
        width={64}
        height={64}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="size-16 shrink-0 rounded-md border border-line bg-surface-muted object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={`truncate ${row.altText ? 'font-medium' : 'text-ink-muted'}`}
          >
            {row.altText ?? 'No description'}
          </p>
          {index === 0 ? (
            <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-strong">
              Main photo
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-sm text-ink-muted">
          {row.altText ? null : `${row.name} · `}
          {row.width} × {row.height} pixels
        </p>
      </div>
      <div className="ml-12 flex items-center gap-1 sm:ml-0">
        <Button
          variant="ghost"
          size="sm"
          icon={Pencil}
          aria-label={`Describe ${row.name}`}
          onClick={onDescribe}
        >
          Describe
        </Button>
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
      </div>
    </Reorder.Item>
  );
}

// Where staff drop files, or choose them: the browser's own file picker,
// behind a label that looks like a button, so the keyboard reaches it.
function DropZone({
  empty,
  left,
  onFiles,
}: {
  empty: boolean;
  left: number;
  onFiles: (files: File[]) => void;
}) {
  const [over, setOver] = useState(false);
  const carriesFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer.types).includes('Files');

  return (
    <div
      onDragEnter={(event) => {
        if (carriesFiles(event)) {
          event.preventDefault();
          setOver(true);
        }
      }}
      onDragOver={(event) => {
        if (carriesFiles(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOver(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onFiles(Array.from(event.dataTransfer.files));
      }}
      className={`mt-4 flex flex-col items-center rounded-lg border-2 border-dashed p-6 text-center transition-colors duration-150 ${
        over ? 'border-primary bg-primary-soft' : 'border-line'
      }`}
    >
      <motion.span
        animate={{ scale: over ? 1.1 : 1 }}
        transition={transition}
        className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary"
      >
        <ImagePlus aria-hidden="true" className="size-5" />
      </motion.span>
      <p className="mt-3 font-medium">
        {empty ? 'No images yet' : 'Add more images'}
      </p>
      <p className="mt-1 max-w-md text-sm text-ink-muted">
        Drop them here, or choose them. JPEG, PNG or WebP, at most 10 MB each,
        at least 400 pixels on each side.{' '}
        {left === 1 ? 'One more fits.' : `${left} more fit.`}
      </p>
      <label
        className={`${buttonClass(empty ? 'primary' : 'secondary')} mt-4 cursor-pointer has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus has-focus-visible:outline-solid`}
      >
        <ImagePlus aria-hidden="true" className="size-4" />
        Choose images
        <input
          type="file"
          multiple
          accept={IMAGE_TYPES.join(',')}
          className="sr-only"
          onChange={(event) => {
            onFiles(Array.from(event.target.files ?? []));
            // The same file can be chosen again after a failure.
            event.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

function UploadRow({
  upload,
  onRetry,
  onRemove,
}: {
  upload: Upload;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const name = upload.file.name;
  const percent = Math.round(upload.sent * 100);
  // All of it sent: the API is checking it, which cannot be called off.
  const checking = upload.state === 'sending' && upload.sent >= 1;
  const status =
    upload.state === 'waiting'
      ? 'Waiting'
      : upload.state === 'sending'
        ? checking
          ? 'Checking the image…'
          : `Uploading, ${percent}%`
        : upload.problem;
  const wrong = upload.state === 'failed' || upload.state === 'refused';

  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition }}
      exit={{
        opacity: 0,
        transition: { duration: DURATION.fast, ease: EASE_OUT },
      }}
      className={`rounded-lg border p-3 ${wrong ? 'border-danger/40' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:flex-nowrap">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-md ${
            wrong
              ? 'bg-danger-soft text-danger'
              : 'bg-surface-muted text-ink-muted'
          }`}
        >
          {wrong ? (
            <TriangleAlert aria-hidden="true" className="size-5" />
          ) : (
            <ImageIcon aria-hidden="true" className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className={`text-sm ${wrong ? 'text-danger' : 'text-ink-muted'}`}>
            {fileSize(upload.file.size)} · {status}
          </p>
        </div>
        <div className="ml-13 flex items-center gap-1 sm:ml-0">
          {upload.state === 'failed' ? (
            <Button
              size="sm"
              icon={RefreshCw}
              aria-label={`Try ${name} again`}
              onClick={onRetry}
            >
              Try again
            </Button>
          ) : null}
          {checking ? null : (
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              aria-label={wrong ? `Remove ${name}` : `Cancel ${name}`}
              onClick={onRemove}
            >
              {wrong ? 'Remove' : 'Cancel'}
            </Button>
          )}
        </div>
      </div>
      {upload.state === 'sending' ? (
        <div className="mt-3">
          {/* The browser's own bar for screen readers (with no value while
              the image is checked: under way, with no end known), and a
              drawn one for the eye. */}
          <progress
            aria-label={`Uploading ${name}`}
            max={100}
            value={checking ? undefined : percent}
            className="sr-only"
          />
          <div
            aria-hidden="true"
            className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
          >
            <motion.div
              className={`h-full rounded-full bg-primary ${checking ? 'animate-pulse' : ''}`}
              initial={false}
              animate={{ width: `${percent}%` }}
              transition={transition}
            />
          </div>
        </div>
      ) : null}
    </motion.li>
  );
}
