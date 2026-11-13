import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ApiError } from '../../api/api-error';
import { fieldProblems, problemMessage } from '../../api/problems';
import { MAX_IMAGES, imageFileProblem, uploadImage } from '../catalog-api';
import { addImage } from '../catalog-queries';

// Where a chosen file is on its way to becoming one of the product's
// images. Refused files cannot be sent as they are; failed ones can be
// tried again.
export type UploadState = 'waiting' | 'sending' | 'failed' | 'refused';

export interface Upload {
  key: string;
  file: File;
  state: UploadState;
  // How much of the file has gone, from 0 to 1.
  sent: number;
  // Why it failed, or was refused.
  problem: string | null;
}

export const NO_ROOM = `There is no room for it: a product has at most ${MAX_IMAGES} images.`;

// The files that will take a place among the images if all goes well.
export function holding(uploads: Upload[]): number {
  return uploads.filter((upload) => upload.state !== 'refused').length;
}

// How many more files staff may add.
export function room(saved: number, uploads: Upload[]): number {
  return Math.max(0, MAX_IMAGES - saved - holding(uploads));
}

export type UploadAction =
  // Files staff chose or dropped, with a key for each, while the product
  // has `saved` images.
  | { type: 'add'; files: File[]; keys: string[]; saved: number }
  | { type: 'start'; key: string }
  | { type: 'progress'; key: string; sent: number }
  | { type: 'fail'; key: string; problem: string; retry: boolean }
  | { type: 'retry'; key: string }
  // Uploaded, cancelled or put away.
  | { type: 'remove'; key: string };

export function reduceUploads(
  uploads: Upload[],
  action: UploadAction,
): Upload[] {
  switch (action.type) {
    case 'add': {
      let left = room(action.saved, uploads);
      const added = action.files.map((file, index): Upload => {
        const problem = imageFileProblem(file) ?? (left > 0 ? null : NO_ROOM);
        if (!problem) {
          left -= 1;
        }
        return {
          key: action.keys[index] ?? String(index),
          file,
          state: problem ? 'refused' : 'waiting',
          sent: 0,
          problem,
        };
      });
      return [...uploads, ...added];
    }
    case 'start':
      return change(uploads, action.key, () => ({
        state: 'sending',
        sent: 0,
        problem: null,
      }));
    case 'progress':
      return change(uploads, action.key, (upload) =>
        upload.state === 'sending' ? { sent: action.sent } : {},
      );
    case 'fail':
      return change(uploads, action.key, () => ({
        state: action.retry ? 'failed' : 'refused',
        problem: action.problem,
      }));
    case 'retry':
      return change(uploads, action.key, (upload) =>
        upload.state === 'failed'
          ? { state: 'waiting', sent: 0, problem: null }
          : {},
      );
    case 'remove':
      return uploads.filter((upload) => upload.key !== action.key);
  }
}

function change(
  uploads: Upload[],
  key: string,
  changes: (upload: Upload) => Partial<Upload>,
): Upload[] {
  return uploads.map((upload) =>
    upload.key === key ? { ...upload, ...changes(upload) } : upload,
  );
}

// Why an upload failed, in staff's words, and whether trying again may
// help: not when the API refused the file itself.
export function uploadFailure(error: unknown): {
  problem: string;
  retry: boolean;
} {
  if (!(error instanceof ApiError)) {
    return { problem: problemMessage(error), retry: true };
  }
  if (error.status === 413) {
    return { problem: 'An image may be at most 10 MB.', retry: false };
  }
  if (error.status === 415) {
    return { problem: 'Choose a JPEG, PNG or WebP image.', retry: false };
  }
  const retry =
    error.status === 0 ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500;
  return {
    problem: fieldProblems(error).image ?? problemMessage(error),
    retry,
  };
}

// A file's size as staff know it: "640 KB", "2.4 MB".
export function fileSize(bytes: number): string {
  const kilobytes = bytes / 1024;
  if (kilobytes < 1000) {
    return `${Math.max(1, Math.ceil(kilobytes))} KB`;
  }
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

// Sends the files staff add to a product, one at a time in the order they
// were chosen, so the images arrive in that order. Each new image goes into
// the cached list as it arrives. Leaving the page stops the one on its way.
export function useImageUploads(productId: string, saved: number) {
  const queryClient = useQueryClient();
  const [uploads, dispatch] = useReducer(reduceUploads, []);
  const [announcement, setAnnouncement] = useState('');
  const sending = useRef<{ key: string; stop: AbortController } | null>(null);
  const nextKey = useRef(0);

  useEffect(() => {
    if (sending.current) {
      return;
    }
    const next = uploads.find((upload) => upload.state === 'waiting');
    if (!next) {
      return;
    }
    const stop = new AbortController();
    const current = { key: next.key, stop };
    sending.current = current;
    dispatch({ type: 'start', key: next.key });
    uploadImage(productId, next.file, {
      signal: stop.signal,
      onProgress: (sent) => dispatch({ type: 'progress', key: next.key, sent }),
    }).then(
      (image) => {
        if (stop.signal.aborted) {
          return;
        }
        sending.current = null;
        addImage(queryClient, image);
        dispatch({ type: 'remove', key: next.key });
        setAnnouncement(`${next.file.name} is added.`);
      },
      (error: unknown) => {
        if (stop.signal.aborted) {
          return;
        }
        sending.current = null;
        const { problem, retry } = uploadFailure(error);
        dispatch({ type: 'fail', key: next.key, problem, retry });
        setAnnouncement(`${next.file.name} could not be added. ${problem}`);
      },
    );
  }, [uploads, productId, queryClient]);

  // Leaving the page stops the file on its way.
  useEffect(
    () => () => {
      sending.current?.stop.abort();
      sending.current = null;
    },
    [],
  );

  const add = useCallback(
    (files: File[]) => {
      if (files.length === 0) {
        return;
      }
      const keys = files.map(() => {
        nextKey.current += 1;
        return `upload-${nextKey.current}`;
      });
      const action: UploadAction = { type: 'add', files, keys, saved };
      const added = reduceUploads(uploads, action).slice(uploads.length);
      dispatch(action);
      const refused = added.filter(
        (upload) => upload.state === 'refused',
      ).length;
      const going = added.length - refused;
      const said: string[] = [];
      if (going > 0) {
        said.push(
          going === 1
            ? '1 image is on its way.'
            : `${going} images are on their way.`,
        );
      }
      if (refused > 0) {
        said.push(
          `${refused === 1 ? '1 file' : `${refused} files`} cannot be added: the list says why.`,
        );
      }
      setAnnouncement(said.join(' '));
    },
    [saved, uploads],
  );

  // Stops a file on its way, or one still waiting, or puts away one that
  // failed.
  const remove = useCallback((key: string) => {
    if (sending.current?.key === key) {
      sending.current.stop.abort();
      sending.current = null;
    }
    dispatch({ type: 'remove', key });
  }, []);

  const retry = useCallback((key: string) => {
    dispatch({ type: 'retry', key });
  }, []);

  return { uploads, announcement, add, remove, retry };
}
