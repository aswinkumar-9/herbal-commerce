import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import { ConcurrencyLimit } from '../common/concurrency-limit';
import type { Prisma } from '../generated/prisma/client';
import { MediaStorage } from '../media/media-storage';
import { PrismaService } from '../prisma/prisma.service';
import { changedFields, pick } from './changes';
import { IMAGE_ORDER, imageFileNames } from './image-files';
import { processImage } from './image-processing';
import type { ImageType } from './image-processing';
import type { ImageUpdateInput } from './images.schemas';
import { PRODUCT_NOT_FOUND } from './products.service';

// A product has at most 6 images (ADR 0023). The database's trigger
// product_images_at_most_six holds the same limit.
export const MAX_IMAGES_PER_PRODUCT = 6;
export const IMAGE_NOT_FOUND = 'Image not found';
export const TOO_MANY_IMAGES = `A product has at most ${MAX_IMAGES_PER_PRODUCT} images. Delete one first.`;

// Everything about an image that staff set or the upload decided: what the
// audit log keeps of it.
const STAFF_FIELDS = [
  'productId',
  'fileKey',
  'width',
  'height',
  'altText',
  'position',
] as const;

const IMAGE_FIELDS = {
  id: true,
  productId: true,
  fileKey: true,
  width: true,
  height: true,
  altText: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductImageSelect;

type ImageRow = Prisma.ProductImageGetPayload<{ select: typeof IMAGE_FIELDS }>;

// An image as staff see it: the addresses of its two files instead of
// their key.
export type StaffImage = Omit<ImageRow, 'fileKey'> & {
  url: string;
  thumbnailUrl: string;
};

// The images of products (ADR 0023). Admins and Super Users add and change
// them, and every change is written to the audit log in the same
// transaction.
@Injectable()
export class ImagesService {
  // Checking and re-encoding an image is the heaviest work the API does:
  // at most 2 at once, and 10 more waiting in line. Beyond that, 503.
  private readonly processing = new ConcurrencyLimit(2, 10);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaStorage,
    @InjectPinoLogger(ImagesService.name)
    private readonly logger: PinoLogger,
  ) {}

  // Every image of a product, the main photo first.
  async listForProduct(productId: string): Promise<{ images: StaffImage[] }> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { images: { orderBy: IMAGE_ORDER, select: IMAGE_FIELDS } },
    });
    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND);
    }
    return { images: product.images.map((image) => this.staffView(image)) };
  }

  // Adds an image to a product: checks and re-encodes it, saves its two
  // files under a new random key, then records it, after any other change
  // to the product has finished. If it is not recorded, its files are
  // deleted again, so no file is left without its image.
  async create(
    productId: string,
    file: Buffer,
    type: ImageType,
    context: AuditContext,
  ): Promise<StaffImage> {
    const processed = await this.processing.run(() =>
      processImage(file, type),
    );
    const fileKey = randomUUID();
    const names = imageFileNames(fileKey);
    try {
      await this.media.save(names.large, processed.large);
      await this.media.save(names.small, processed.small);
      const image = await this.prisma.$transaction(async (tx) => {
        await this.lockProduct(tx, productId);
        const count = await tx.productImage.count({ where: { productId } });
        if (count >= MAX_IMAGES_PER_PRODUCT) {
          throw new ConflictException(TOO_MANY_IMAGES);
        }
        const created = await tx.productImage.create({
          data: {
            productId,
            fileKey,
            width: processed.width,
            height: processed.height,
          },
          select: IMAGE_FIELDS,
        });
        // In the same transaction: no image without its audit entry.
        await this.audit.record(tx, {
          ...context,
          action: 'image.created',
          targetType: 'image',
          targetId: created.id,
          after: pick(created, STAFF_FIELDS),
        });
        return created;
      });
      this.logger.info(
        { imageId: image.id, productId, actorId: context.actorId },
        'Image added',
      );
      return this.staffView(image);
    } catch (error) {
      await this.removeFiles(fileKey);
      throw error;
    }
  }

  // Changes an image's description or its place. The photo itself never
  // changes: a new photo is a new upload. A request with no real change is
  // not audited.
  async update(
    id: string,
    input: ImageUpdateInput,
    context: AuditContext,
  ): Promise<StaffImage> {
    const { image, changed } = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedImage(tx, id);
      const fields = changedFields(current, input);
      if (fields.length === 0) {
        return { image: current, changed: false };
      }
      const before = pick(current, fields);
      const after = pick(input, fields);
      const updated = await tx.productImage.update({
        where: { id },
        data: after,
        select: IMAGE_FIELDS,
      });
      await this.audit.record(tx, {
        ...context,
        action: 'image.updated',
        targetType: 'image',
        targetId: id,
        before,
        after,
      });
      return { image: updated, changed: true };
    });
    if (changed) {
      this.logger.info(
        { imageId: id, actorId: context.actorId },
        'Image changed',
      );
    }
    return this.staffView(image);
  }

  // Locks the product until the transaction ends, or answers 404. Uploads,
  // deletions and going live take turns for each product, so its images
  // are counted right. The ID is sent as a parameter, never pasted into
  // the SQL.
  private async lockProduct(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
    if (locked.length === 0) {
      throw new NotFoundException(PRODUCT_NOT_FOUND);
    }
  }

  // Locks the image until the transaction ends, then reads it, or answers
  // 404. One change at a time for each image, so an audit entry's "before"
  // is exactly what the change replaced.
  private async lockedImage(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<ImageRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM product_images WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) {
      throw new NotFoundException(IMAGE_NOT_FOUND);
    }
    return tx.productImage.findUniqueOrThrow({
      where: { id },
      select: IMAGE_FIELDS,
    });
  }

  // Deletes an image's two files. A failure is logged, never thrown: a file
  // left behind only takes space, and the error that led here matters more.
  private async removeFiles(fileKey: string): Promise<void> {
    const names = imageFileNames(fileKey);
    try {
      await this.media.remove(names.large);
      await this.media.remove(names.small);
    } catch (error) {
      this.logger.warn({ err: error, fileKey }, 'Image files not deleted');
    }
  }

  private staffView({ fileKey, ...image }: ImageRow): StaffImage {
    const names = imageFileNames(fileKey);
    return {
      ...image,
      url: this.media.url(names.large),
      thumbnailUrl: this.media.url(names.small),
    };
  }
}
