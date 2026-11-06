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
import { IMAGE_ORDER, imageFileNames, removeImageFiles } from './image-files';
import { processImage } from './image-processing';
import type { ImageType } from './image-processing';
import type { ImageUpdateInput } from './images.schemas';
import { PRODUCT_NOT_FOUND } from './products.service';

// A product has at most 6 images (ADR 0023). The database's trigger
// product_images_at_most_six holds the same limit.
export const MAX_IMAGES_PER_PRODUCT = 6;
export const IMAGE_NOT_FOUND = 'Image not found';
export const TOO_MANY_IMAGES = `A product has at most ${MAX_IMAGES_PER_PRODUCT} images. Delete one first.`;
export const LAST_IMAGE_OF_LIVE_PRODUCT =
  'A live product needs at least one image. Add another first, or take the product offline.';

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

// The images of products (ADR 0023). Admins and Super Users add, change
// and delete them, and every change is written to the audit log in the
// same transaction.
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
      await removeImageFiles(this.media, this.logger, fileKey);
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

  // Deletes an image for good. Admins may too: replacing a photo is
  // everyday work (ADR 0023). A live product keeps at least one image. The
  // audit entry keeps what the image was; its files are deleted once the
  // deletion is saved, so a failed deletion never leaves an image without
  // its files.
  async remove(id: string, context: AuditContext): Promise<void> {
    const deleted = await this.prisma.$transaction(async (tx) => {
      // An image never moves to another product, so its product can be
      // read before anything is locked.
      const image = await tx.productImage.findUnique({
        where: { id },
        select: { productId: true },
      });
      if (!image) {
        throw new NotFoundException(IMAGE_NOT_FOUND);
      }
      // The product first, as uploads and going live lock it too.
      await this.lockProduct(tx, image.productId);
      const current = await this.lockedImage(tx, id);
      const product = await tx.product.findUniqueOrThrow({
        where: { id: current.productId },
        select: { isActive: true },
      });
      const count = await tx.productImage.count({
        where: { productId: current.productId },
      });
      if (product.isActive && count <= 1) {
        throw new ConflictException(LAST_IMAGE_OF_LIVE_PRODUCT);
      }
      await tx.productImage.delete({ where: { id }, select: { id: true } });
      await this.audit.record(tx, {
        ...context,
        action: 'image.deleted',
        targetType: 'image',
        targetId: id,
        before: pick(current, STAFF_FIELDS),
      });
      return current;
    });
    await removeImageFiles(this.media, this.logger, deleted.fileKey);
    this.logger.info(
      { imageId: id, productId: deleted.productId, actorId: context.actorId },
      'Image deleted',
    );
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

  private staffView({ fileKey, ...image }: ImageRow): StaffImage {
    const names = imageFileNames(fileKey);
    return {
      ...image,
      url: this.media.url(names.large),
      thumbnailUrl: this.media.url(names.small),
    };
  }
}
