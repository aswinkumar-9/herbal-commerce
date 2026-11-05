import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '../config/env';
import { MediaStorage } from './media-storage';

const NAME = 'products/3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e-large.webp';

describe('MediaStorage', () => {
  let directory: string;
  let storage: MediaStorage;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'media-test-'));
    const settings: Record<string, string> = {
      MEDIA_DIR: directory,
      MEDIA_BASE_URL: 'http://127.0.0.1:3000/media',
    };
    const config = { get: (key: string) => settings[key] };
    storage = new MediaStorage(
      config as unknown as ConfigService<Env, true>,
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('saves a file in a folder it makes, and says where the shop finds it', async () => {
    await storage.save(NAME, Buffer.from('image bytes'));

    await expect(readFile(join(directory, NAME), 'utf8')).resolves.toBe(
      'image bytes',
    );
    expect(storage.directory).toBe(directory);
    expect(storage.url(NAME)).toBe(`http://127.0.0.1:3000/media/${NAME}`);
  });

  it('never replaces a file', async () => {
    await storage.save(NAME, Buffer.from('first'));

    await expect(storage.save(NAME, Buffer.from('second'))).rejects.toMatchObject({
      code: 'EEXIST',
    });
    await expect(readFile(join(directory, NAME), 'utf8')).resolves.toBe('first');
  });

  it('deletes a file, and one already gone is fine', async () => {
    await storage.save(NAME, Buffer.from('image bytes'));

    await storage.remove(NAME);
    await expect(readFile(join(directory, NAME))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(storage.remove(NAME)).resolves.toBeUndefined();
  });

  it('takes only names the API makes, so none leads out of the folder', async () => {
    await writeFile(join(directory, 'keep.webp'), 'not to be deleted');
    const names = [
      '../keep.webp',
      'products/../../keep.webp',
      '/etc/hosts.webp',
      'C:/Windows/win.ini',
      'products\\x.webp',
      '.hidden.webp',
      'products/.hidden.webp',
      'Products/X.webp',
      'products/x',
      'products//x.webp',
      '',
    ];
    for (const name of names) {
      await expect(storage.save(name, Buffer.from('x'))).rejects.toThrow(
        'Not a media file name',
      );
      await expect(storage.remove(name)).rejects.toThrow('Not a media file name');
      expect(() => storage.url(name)).toThrow('Not a media file name');
    }
    await expect(readFile(join(directory, 'keep.webp'), 'utf8')).resolves.toBe(
      'not to be deleted',
    );
  });
});
