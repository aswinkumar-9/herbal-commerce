import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/api-error';
import {
  NO_ROOM,
  fileSize,
  holding,
  reduceUploads,
  room,
  uploadFailure,
} from './image-uploads';
import type { Upload } from './image-uploads';

const photo = (name: string, type = 'image/jpeg', size = 2048) =>
  new File([new Uint8Array(size)], name, { type });

function upload(key: string, state: Upload['state']): Upload {
  return { key, file: photo(`${key}.jpg`), state, sent: 0, problem: null };
}

const add = (uploads: Upload[], files: File[], saved: number) =>
  reduceUploads(uploads, {
    type: 'add',
    files,
    keys: files.map((_, index) => `k${index + 1}`),
    saved,
  });

describe('the room for more images', () => {
  it('counts every file on its way, or that may be tried again, but not a refused one', () => {
    const uploads = [
      upload('a', 'waiting'),
      upload('b', 'sending'),
      upload('c', 'failed'),
      upload('d', 'refused'),
    ];
    expect(holding(uploads)).toBe(3);
    expect(room(2, uploads)).toBe(1);
    expect(room(3, uploads)).toBe(0);
    expect(room(6, uploads)).toBe(0);
    expect(room(0, [])).toBe(6);
  });
});

describe('adding files', () => {
  it('lines up the ones that can go, in the order chosen, and refuses the rest with the reason', () => {
    const before = [upload('a', 'sending')];
    const after = add(
      before,
      [
        photo('IMG_0042.HEIC', ''),
        photo('front.jpg'),
        photo('empty.png', 'image/png', 0),
        photo('back.webp', 'image/webp'),
        photo('side.png', 'image/png'),
      ],
      // With the one on its way: room for 2.
      3,
    );

    expect(after[0]).toBe(before[0]);
    expect(
      after
        .slice(1)
        .map(({ key, file, state, problem }) => [
          key,
          file.name,
          state,
          problem,
        ]),
    ).toEqual([
      [
        'k1',
        'IMG_0042.HEIC',
        'refused',
        'HEIC photos cannot be used. Save it as a JPEG first.',
      ],
      ['k2', 'front.jpg', 'waiting', null],
      ['k3', 'empty.png', 'refused', 'The file is empty.'],
      ['k4', 'back.webp', 'waiting', null],
      ['k5', 'side.png', 'refused', NO_ROOM],
    ]);
    expect(NO_ROOM).toBe(
      'There is no room for it: a product has at most 6 images.',
    );
  });
});

describe('a file on its way', () => {
  const waiting = [upload('a', 'waiting'), upload('b', 'waiting')];

  it('starts from nothing sent, and follows its progress', () => {
    let uploads = reduceUploads(waiting, { type: 'start', key: 'a' });
    expect(uploads[0]).toMatchObject({ state: 'sending', sent: 0 });
    uploads = reduceUploads(uploads, { type: 'progress', key: 'a', sent: 0.5 });
    expect(uploads[0]?.sent).toBe(0.5);
    // Only the one being sent moves.
    uploads = reduceUploads(uploads, { type: 'progress', key: 'b', sent: 0.5 });
    expect(uploads[1]?.sent).toBe(0);
  });

  it('fails, so it can be tried again, or is refused for good', () => {
    const sending = reduceUploads(waiting, { type: 'start', key: 'a' });

    const failed = reduceUploads(sending, {
      type: 'fail',
      key: 'a',
      problem: 'The server had a problem. Try again in a moment.',
      retry: true,
    });
    expect(failed[0]).toMatchObject({
      state: 'failed',
      problem: 'The server had a problem. Try again in a moment.',
    });
    expect(reduceUploads(failed, { type: 'retry', key: 'a' })[0]).toEqual({
      ...failed[0],
      state: 'waiting',
      sent: 0,
      problem: null,
    });

    const refused = reduceUploads(sending, {
      type: 'fail',
      key: 'a',
      problem: 'The image needs at least 400 pixels on each side',
      retry: false,
    });
    expect(refused[0]?.state).toBe('refused');
    // Trying a refused file again would only be refused again.
    expect(reduceUploads(refused, { type: 'retry', key: 'a' })).toEqual(
      refused,
    );
  });

  it('goes from the list once added, cancelled or put away', () => {
    expect(reduceUploads(waiting, { type: 'remove', key: 'a' })).toEqual([
      waiting[1],
    ]);
  });
});

describe('why an upload failed', () => {
  it('offers to try again when the file never arrived, or the server could not take it', () => {
    expect(uploadFailure(new ApiError(0, "Can't reach the server."))).toEqual({
      problem: "Can't reach the server.",
      retry: true,
    });
    expect(uploadFailure(new ApiError(503, 'Busy'))).toEqual({
      problem: 'The server had a problem. Try again in a moment.',
      retry: true,
    });
    expect(uploadFailure(new ApiError(429, 'Too many'))).toMatchObject({
      retry: true,
    });
    expect(uploadFailure(new ApiError(408, 'Timeout'))).toMatchObject({
      retry: true,
    });
    expect(uploadFailure(new Error('odd'))).toEqual({
      problem: 'Something went wrong. Try again.',
      retry: true,
    });
  });

  it('says why the API refused the file, with no second try', () => {
    const tooSmall = new ApiError(400, 'Validation failed', {
      fieldErrors: [
        {
          field: 'image',
          message: 'The image needs at least 400 pixels on each side',
        },
      ],
    });
    expect(uploadFailure(tooSmall)).toEqual({
      problem: 'The image needs at least 400 pixels on each side',
      retry: false,
    });
    expect(
      uploadFailure(
        new ApiError(409, 'A product has at most 6 images. Delete one first.'),
      ),
    ).toEqual({
      problem: 'A product has at most 6 images. Delete one first.',
      retry: false,
    });
    expect(
      uploadFailure(new ApiError(413, 'request entity too large')),
    ).toEqual({ problem: 'An image may be at most 10 MB.', retry: false });
    expect(uploadFailure(new ApiError(415, 'Send one JPEG…'))).toEqual({
      problem: 'Choose a JPEG, PNG or WebP image.',
      retry: false,
    });
  });
});

describe("a file's size", () => {
  it.each([
    [0, '1 KB'],
    [1500, '2 KB'],
    [999 * 1024, '999 KB'],
    [1000 * 1024, '1.0 MB'],
    [2.5 * 1024 * 1024, '2.5 MB'],
  ])('%i bytes is %s', (bytes, shown) => {
    expect(fileSize(bytes)).toBe(shown);
  });
});
