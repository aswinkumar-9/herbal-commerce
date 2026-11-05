import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import sharp from 'sharp';
import { AuditService } from '../audit/audit.service';
import { RetryLaterException } from '../common/retry-later.exception';
import { MediaStorage } from '../media/media-storage';
import { PrismaService } from '../prisma/prisma.service';
import { IMAGE_ORDER } from './image-files';
import { detectImageType } from './image-processing';
import {
  IMAGE_NOT_FOUND,
  ImagesService,
  TOO_MANY_IMAGES,
} from './images.service';

const ID = '6c5b4a39-2817-4f06-b5e4-d3c2b1a09f8e';
const PRODUCT = '3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e';
const KEY = 'b1c2d3e4-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const BASE = 'http://127.0.0.1:3000/media';
const createdAt = new Date('2026-11-05T10:30:00.000Z');
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};

// An image as the query returns it.
function stored(changes: object = {}) {
  return {
    id: ID,
    productId: PRODUCT,
    fileKey: KEY,
    width: 800,
    height: 600,
    altText: null,
    position: 0,
    createdAt,
    updatedAt: createdAt,
    ...changes,
  };
}

// The same image as staff see it.
function shown(changes: object = {}) {
  const { fileKey, ...image } = stored(changes);
  return {
    ...image,
    url: `${BASE}/products/${fileKey}-large.webp`,
    thumbnailUrl: `${BASE}/products/${fileKey}-small.webp`,
  };
}

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: PRODUCT }]),
    productImage: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((args: { data: object }) =>
        Promise.resolve(stored(args.data)),
      ),
      findUniqueOrThrow: jest.fn().mockResolvedValue(stored()),
      update: jest.fn().mockResolvedValue(stored({ altText: 'Back label' })),
    },
  };
  const prisma = {
    product: {
      findUnique: jest.fn().mockResolvedValue({ images: [stored()] }),
    },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  // The files saved and not deleted again.
  const files = new Map<string, Buffer>();
  const media = {
    save: jest.fn((name: string, data: Buffer) => {
      files.set(name, data);
      return Promise.resolve();
    }),
    remove: jest.fn((name: string) => {
      files.delete(name);
      return Promise.resolve();
    }),
    url: jest.fn((name: string) => `${BASE}/${name}`),
  };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const service = new ImagesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    media as unknown as MediaStorage,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, audit, media, files, logger };
}

// The key of the files saved first.
function savedKey(media: { save: jest.Mock }): string {
  const [name] = media.save.mock.calls[0] as [string];
  const key = /^products\/([0-9a-f-]{36})-large\.webp$/.exec(name)?.[1];
  expect(key).toBeDefined();
  return key ?? '';
}

let photo: Buffer;

beforeAll(async () => {
  photo = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#4a8c5a' },
  })
    .jpeg()
    .toBuffer();
});

describe('ImagesService.listForProduct', () => {
  it('lists the images of a product, the main photo first, with the addresses of their files', async () => {
    const { service, prisma } = setup();

    await expect(service.listForProduct(PRODUCT)).resolves.toEqual({
      images: [shown()],
    });
    expect(prisma.product.findUnique).toHaveBeenCalledWith({
      where: { id: PRODUCT },
      select: { images: { orderBy: IMAGE_ORDER, select: expect.any(Object) } },
    });
    expect(IMAGE_ORDER).toEqual([
      { position: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('answers 404 for an unknown product', async () => {
    const { service, prisma } = setup();
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(service.listForProduct(PRODUCT)).rejects.toThrow(
      new NotFoundException('Product not found'),
    );
  });
});

describe('ImagesService.create', () => {
  it('saves two WebP files under a new key, then records the image and its audit entry in one transaction', async () => {
    const { service, tx, audit, media, files, logger } = setup();

    const image = await service.create(PRODUCT, photo, 'image/jpeg', context);

    const key = savedKey(media);
    expect([...files.keys()]).toEqual([
      `products/${key}-large.webp`,
      `products/${key}-small.webp`,
    ]);
    for (const file of files.values()) {
      expect(detectImageType(file)).toBe('image/webp');
    }
    expect(tx.productImage.create).toHaveBeenCalledWith({
      data: { productId: PRODUCT, fileKey: key, width: 800, height: 600 },
      select: expect.any(Object),
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'image.created',
      targetType: 'image',
      targetId: ID,
      after: {
        productId: PRODUCT,
        fileKey: key,
        width: 800,
        height: 600,
        altText: null,
        position: 0,
      },
    });
    expect(image).toEqual(shown({ fileKey: key }));
    expect(logger.info).toHaveBeenCalledWith(
      { imageId: ID, productId: PRODUCT, actorId: context.actorId },
      'Image added',
    );
    // The files exist before the image is recorded.
    expect(media.save.mock.invocationCallOrder[1]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0],
    );
  });

  it('gives every upload a new key', async () => {
    const { service, media } = setup();

    await service.create(PRODUCT, photo, 'image/jpeg', context);
    await service.create(PRODUCT, photo, 'image/jpeg', context);

    const [first, , second] = media.save.mock.calls.map(([name]) => name);
    expect(first).not.toBe(second);
  });

  it('checks at most 2 images at once with 10 waiting, and answers 503 to the next', async () => {
    const { service } = setup();

    // All 13 start before any check has finished.
    const results = await Promise.allSettled(
      Array.from({ length: 13 }, () =>
        service.create(PRODUCT, photo, 'image/jpeg', context),
      ),
    );

    const refused = results.filter((result) => result.status === 'rejected');
    expect(results.length - refused.length).toBe(12);
    expect(refused).toHaveLength(1);
    const error = (refused[0] as PromiseRejectedResult).reason as unknown;
    expect(error).toBeInstanceOf(RetryLaterException);
    expect((error as RetryLaterException).getStatus()).toBe(503);
  });

  it('locks the product, then counts its images, then records the new one', async () => {
    const { service, tx } = setup();

    await service.create(PRODUCT, photo, 'image/jpeg', context);

    const [sql, id] = tx.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join('?')).toMatch(/FROM products WHERE id = \?::uuid FOR UPDATE/);
    expect(id).toBe(PRODUCT);
    expect(tx.productImage.count).toHaveBeenCalledWith({
      where: { productId: PRODUCT },
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.productImage.count.mock.invocationCallOrder[0],
    );
    expect(tx.productImage.count.mock.invocationCallOrder[0]).toBeLessThan(
      tx.productImage.create.mock.invocationCallOrder[0],
    );
  });

  it('takes a sixth image, refuses a seventh with 409, and deletes its files', async () => {
    const { service, tx, audit, files, media } = setup();
    tx.productImage.count.mockResolvedValue(5);
    await service.create(PRODUCT, photo, 'image/jpeg', context);
    expect(files.size).toBe(2);

    files.clear();
    media.save.mockClear();
    tx.productImage.create.mockClear();
    audit.record.mockClear();
    tx.productImage.count.mockResolvedValue(6);

    await expect(
      service.create(PRODUCT, photo, 'image/jpeg', context),
    ).rejects.toThrow(new ConflictException(TOO_MANY_IMAGES));
    expect(TOO_MANY_IMAGES).toBe(
      'A product has at most 6 images. Delete one first.',
    );
    expect(tx.productImage.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    const key = savedKey(media);
    expect(media.remove).toHaveBeenCalledWith(`products/${key}-large.webp`);
    expect(media.remove).toHaveBeenCalledWith(`products/${key}-small.webp`);
    expect(files.size).toBe(0);
  });

  it('answers 404 for an unknown product, and deletes the files', async () => {
    const { service, tx, files } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      service.create(PRODUCT, photo, 'image/jpeg', context),
    ).rejects.toThrow(new NotFoundException('Product not found'));
    expect(tx.productImage.create).not.toHaveBeenCalled();
    expect(files.size).toBe(0);
  });

  it('refuses an image that fails the checks before saving anything', async () => {
    const { service, prisma, media } = setup();

    await expect(
      service.create(PRODUCT, Buffer.from('not an image'), 'image/jpeg', context),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(media.save).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('still answers with the first error when the files cannot be deleted, and logs them', async () => {
    const { service, tx, media, logger } = setup();
    tx.productImage.count.mockResolvedValue(6);
    media.remove.mockRejectedValue(new Error('Disk unavailable'));

    await expect(
      service.create(PRODUCT, photo, 'image/jpeg', context),
    ).rejects.toThrow(new ConflictException(TOO_MANY_IMAGES));
    expect(logger.warn).toHaveBeenCalledWith(
      { err: new Error('Disk unavailable'), fileKey: savedKey(media) },
      'Image files not deleted',
    );
  });
});

describe('ImagesService.update', () => {
  it('locks the image, saves only what changes, and records it before and after', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(
      service.update(ID, { altText: 'Back label', position: 0 }, context),
    ).resolves.toEqual(shown({ altText: 'Back label' }));

    const [sql, id] = tx.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join('?')).toMatch(
      /FROM product_images WHERE id = \?::uuid FOR UPDATE/,
    );
    expect(id).toBe(ID);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.productImage.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
    expect(tx.productImage.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { altText: 'Back label' },
      select: expect.any(Object),
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'image.updated',
      targetType: 'image',
      targetId: ID,
      before: { altText: null },
      after: { altText: 'Back label' },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { imageId: ID, actorId: context.actorId },
      'Image changed',
    );
  });

  it('changes and records nothing when every value is already the same', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(
      service.update(ID, { altText: null, position: 0 }, context),
    ).resolves.toEqual(shown());
    expect(tx.productImage.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown image, and changes nothing', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      service.update(ID, { position: 1 }, context),
    ).rejects.toThrow(new NotFoundException(IMAGE_NOT_FOUND));
    expect(tx.productImage.update).not.toHaveBeenCalled();
  });
});
