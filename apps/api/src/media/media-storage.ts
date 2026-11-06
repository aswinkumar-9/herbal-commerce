import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Env } from '../config/env';

// A file name the API made itself: lowercase letters, digits and hyphens,
// in folders, with one extension, such as "products/<key>-large.webp".
// Nothing else, so no name can lead out of the folder or to a hidden file.
const MEDIA_NAME = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*\.[a-z0-9]+$/;

// Keeps uploaded files, such as product images, and says where the shop
// finds them (ADR 0023). On a laptop they are files in MEDIA_DIR, which the
// API serves at /media. When the API is deployed, object storage behind a
// CDN takes this class's place, with the same three methods.
@Injectable()
export class MediaStorage {
  // The folder, as a full path.
  readonly directory: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.directory = resolve(config.get('MEDIA_DIR', { infer: true }));
    this.baseUrl = config.get('MEDIA_BASE_URL', { infer: true });
  }

  // Saves a new file. It never replaces one: a changed image gets a new
  // name, so browsers may keep a file for good.
  async save(name: string, data: Buffer): Promise<void> {
    const path = this.pathOf(name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
  }

  // Deletes a file. One that is already gone is fine.
  async remove(name: string): Promise<void> {
    await rm(this.pathOf(name), { force: true });
  }

  // Where the shop finds the file.
  url(name: string): string {
    checkName(name);
    return `${this.baseUrl}/${name}`;
  }

  private pathOf(name: string): string {
    checkName(name);
    return join(this.directory, name);
  }
}

function checkName(name: string): void {
  if (!MEDIA_NAME.test(name)) {
    throw new Error(`Not a media file name: ${JSON.stringify(name)}`);
  }
}
