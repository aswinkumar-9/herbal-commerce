import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { PackUnit } from '../generated/prisma/enums';
import { MediaStorage } from '../media/media-storage';
import { PrismaService } from '../prisma/prisma.service';
import { IMAGE_ORDER, imageFileNames } from './image-files';

// A pack size as another module may know it: the cart (ADR 0025) and
// orders (ADR 0026). They ask the catalog, never its tables (ADR 0001).
export interface ShopPack {
  // For the asking module's own records only: the shop shows no IDs.
  variantId: string;
  // Every pack size of the same product, this one included.
  productVariantIds: string[];
  sku: string;
  quantity: number;
  unit: PackUnit;
  mrpRupees: number;
  priceRupees: number;
  // The product's HSN code and GST rate, for an order and its invoice
  // (ADR 0022). A live product always has both.
  hsnCode: string | null;
  gstRate: number | null;
  // Sold now: on sale, in a live product of an active category, exactly
  // when the shop shows it.
  onSale: boolean;
  // The product's name and slug, and the small file of its main photo.
  product: { name: string; slug: string; imageUrl: string | null };
}

const PACK_FIELDS = {
  id: true,
  sku: true,
  quantity: true,
  unit: true,
  mrpRupees: true,
  priceRupees: true,
  isActive: true,
  product: {
    select: {
      name: true,
      slug: true,
      hsnCode: true,
      gstRate: true,
      isActive: true,
      category: { select: { isActive: true } },
      variants: { select: { id: true } },
      images: { orderBy: IMAGE_ORDER, take: 1, select: { fileKey: true } },
    },
  },
} satisfies Prisma.ProductVariantSelect;

type PackRow = Prisma.ProductVariantGetPayload<{ select: typeof PACK_FIELDS }>;

// Pack sizes for the other modules, each with whether it is sold now.
@Injectable()
export class ShopPacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaStorage,
  ) {}

  // The pack size with this SKU, sold now or not, or null when none has it.
  async findBySku(sku: string): Promise<ShopPack | null> {
    const row = await this.prisma.productVariant.findUnique({
      where: { sku },
      select: PACK_FIELDS,
    });
    return row ? this.shopPack(row) : null;
  }

  // These pack sizes, sold now or not. One that no longer exists is left
  // out.
  async findByIds(variantIds: string[]): Promise<ShopPack[]> {
    if (variantIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: PACK_FIELDS,
    });
    return rows.map((row) => this.shopPack(row));
  }

  private shopPack({ id, isActive, product, ...pack }: PackRow): ShopPack {
    const image = product.images[0];
    return {
      variantId: id,
      productVariantIds: product.variants.map((variant) => variant.id),
      ...pack,
      hsnCode: product.hsnCode,
      gstRate: product.gstRate,
      onSale: isActive && product.isActive && product.category.isActive,
      product: {
        name: product.name,
        slug: product.slug,
        imageUrl: image
          ? this.media.url(imageFileNames(image.fileKey).small)
          : null,
      },
    };
  }
}
