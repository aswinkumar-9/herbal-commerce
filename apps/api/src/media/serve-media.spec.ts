import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { serveMedia } from './serve-media';

const FILE = 'products/3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e-large.webp';

describe('serveMedia', () => {
  let outside: string;
  let app: NestExpressApplication;

  beforeAll(async () => {
    // The media folder, with a file outside it that must never be served.
    outside = await mkdtemp(join(tmpdir(), 'serve-media-test-'));
    const directory = join(outside, 'media');
    await mkdir(join(directory, 'products'), { recursive: true });
    await writeFile(join(directory, FILE), 'webp bytes');
    await writeFile(join(directory, '.hidden'), 'HIDDEN FILE CONTENT');
    await writeFile(join(directory, 'index.html'), 'INDEX FILE CONTENT');
    await writeFile(join(outside, 'secret.txt'), 'SECRET FILE CONTENT');

    const moduleRef = await Test.createTestingModule({}).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    // As in main.ts: helmet first.
    app.use(helmet());
    serveMedia(app, directory);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await rm(outside, { recursive: true, force: true });
  });

  it('serves a file as an image any site may show, kept by browsers for a year', async () => {
    const response = await request(app.getHttpServer()).get(`/media/${FILE}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('answers 404 for a folder, a hidden file, a missing file, or a way out of the folder', async () => {
    const paths = [
      '/media/',
      '/media/products',
      '/media/products/',
      '/media/.hidden',
      '/media/products/missing.webp',
      '/media/%2e%2e/secret.txt',
      '/media/..%2fsecret.txt',
      '/media/products/%2e%2e/%2e%2e/secret.txt',
    ];
    for (const path of paths) {
      const response = await request(app.getHttpServer()).get(path);
      expect([path, response.status]).toEqual([path, 404]);
      expect(response.text).not.toContain('FILE CONTENT');
    }
  });

  it('only reads: a POST is not served', async () => {
    const response = await request(app.getHttpServer())
      .post(`/media/${FILE}`)
      .send('x');
    expect(response.status).toBe(404);
  });
});
