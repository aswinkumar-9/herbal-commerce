import { MediaStorage } from '../media/media-storage';
import { PrismaService } from '../prisma/prisma.service';
import { ShopPacksService } from './shop-packs.service';

const V60 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const V120 = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const FILE_KEY = 'b1c2d3e4-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const PRODUCT = '7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a';
const WELLNESS = '2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b';
const IMMUNITY = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';
const HIMALAYA = '8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f';

// A pack size as the query returns it: on sale, in a live product of an
// active category, with a photo.
function row(changes: object = {}, productChanges: object = {}) {
  return {
    id: V60,
    sku: 'ASH-CAP-60',
    quantity: 60,
    unit: 'CAPSULES',
    mrpRupees: 500,
    priceRupees: 449,
    isActive: true,
    product: {
      id: PRODUCT,
      name: 'Ashwagandha Capsules',
      slug: 'ashwagandha-capsules',
      hsnCode: '300490',
      gstRate: 5,
      isActive: true,
      category: {
        id: WELLNESS,
        name: 'Wellness',
        isActive: true,
        parent: null,
      },
      brand: { id: HIMALAYA, name: 'Himalaya' },
      variants: [{ id: V60 }, { id: V120 }],
      images: [{ fileKey: FILE_KEY }],
      ...productChanges,
    },
    ...changes,
  };
}

function setup() {
  const prisma = {
    productVariant: {
      findUnique: jest.fn().mockResolvedValue(row()),
      findMany: jest.fn().mockResolvedValue([row()]),
    },
  };
  const media = { url: jest.fn((name: string) => `http://media/${name}`) };
  const packs = new ShopPacksService(
    prisma as unknown as PrismaService,
    media as unknown as MediaStorage,
  );
  return { packs, prisma, media };
}

describe('ShopPacksService', () => {
  it('finds a pack size by its SKU, with its product, its photo, its GST details and every size of the product', async () => {
    const { packs, prisma } = setup();

    await expect(packs.findBySku('ASH-CAP-60')).resolves.toEqual({
      variantId: V60,
      productVariantIds: [V60, V120],
      sku: 'ASH-CAP-60',
      quantity: 60,
      unit: 'CAPSULES',
      mrpRupees: 500,
      priceRupees: 449,
      hsnCode: '300490',
      gstRate: 5,
      onSale: true,
      product: {
        name: 'Ashwagandha Capsules',
        slug: 'ashwagandha-capsules',
        imageUrl: `http://media/products/${FILE_KEY}-small.webp`,
      },
      reportGroups: {
        productId: PRODUCT,
        topCategoryId: WELLNESS,
        topCategoryName: 'Wellness',
        subcategoryId: null,
        subcategoryName: null,
        brandId: HIMALAYA,
        brandName: 'Himalaya',
      },
    });
    expect(prisma.productVariant.findUnique.mock.calls[0][0].where).toEqual({
      sku: 'ASH-CAP-60',
    });
    // Whether its category is active, and the top category it sits in;
    // and for reports, their names and its brand's (part 15C).
    const product =
      prisma.productVariant.findUnique.mock.calls[0][0].select.product.select;
    expect(product.category).toEqual({
      select: {
        id: true,
        name: true,
        isActive: true,
        parent: { select: { id: true, name: true, isActive: true } },
      },
    });
    expect(product.brand).toEqual({ select: { id: true, name: true } });
    expect(product.id).toBe(true);
  });

  it('is reported under its top category and its subcategory, and without a brand as none (part 15C)', async () => {
    const { packs, prisma } = setup();
    prisma.productVariant.findMany.mockResolvedValue([
      row(
        {},
        {
          category: {
            id: IMMUNITY,
            name: 'Immunity',
            isActive: true,
            parent: { id: WELLNESS, name: 'Wellness', isActive: true },
          },
          brand: null,
        },
      ),
    ]);

    const [pack] = await packs.findByIds([V60]);
    expect(pack?.reportGroups).toEqual({
      productId: PRODUCT,
      topCategoryId: WELLNESS,
      topCategoryName: 'Wellness',
      subcategoryId: IMMUNITY,
      subcategoryName: 'Immunity',
      brandId: null,
      brandName: null,
    });
  });

  it('is sold in a subcategory while it and its top category are active', async () => {
    const { packs, prisma } = setup();
    prisma.productVariant.findUnique.mockResolvedValue(
      row({}, { category: { isActive: true, parent: { isActive: true } } }),
    );

    await expect(packs.findBySku('ASH-CAP-60')).resolves.toMatchObject({
      onSale: true,
    });
  });

  it('is not sold now when the pack is off sale, or its product, its category or its top category is hidden', async () => {
    const { packs, prisma } = setup();
    prisma.productVariant.findUnique
      .mockResolvedValueOnce(row({ isActive: false }))
      .mockResolvedValueOnce(row({}, { isActive: false }))
      .mockResolvedValueOnce(
        row({}, { category: { isActive: false, parent: null } }),
      )
      .mockResolvedValueOnce(
        row({}, { category: { isActive: true, parent: { isActive: false } } }),
      )
      .mockResolvedValueOnce(
        row({}, { category: { isActive: false, parent: { isActive: true } } }),
      );

    for (let i = 0; i < 5; i++) {
      await expect(packs.findBySku('ASH-CAP-60')).resolves.toMatchObject({
        onSale: false,
      });
    }
  });

  it('has no photo address for a product without images', async () => {
    const { packs, prisma, media } = setup();
    prisma.productVariant.findUnique.mockResolvedValue(
      row({}, { isActive: false, images: [] }),
    );

    const pack = await packs.findBySku('ASH-CAP-60');
    expect(pack?.product.imageUrl).toBeNull();
    expect(media.url).not.toHaveBeenCalled();
  });

  it('answers null for an unknown SKU, looked up exactly as given', async () => {
    const { packs, prisma } = setup();
    prisma.productVariant.findUnique.mockResolvedValue(null);

    await expect(packs.findBySku('ash-cap-60')).resolves.toBeNull();
    expect(prisma.productVariant.findUnique.mock.calls[0][0].where).toEqual({
      sku: 'ash-cap-60',
    });
  });

  it('finds pack sizes by their IDs, and asks nothing for none', async () => {
    const { packs, prisma } = setup();

    await expect(packs.findByIds([])).resolves.toEqual([]);
    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();

    const found = await packs.findByIds([V60, V120]);
    expect(found.map((pack) => pack.sku)).toEqual(['ASH-CAP-60']);
    expect(prisma.productVariant.findMany.mock.calls[0][0].where).toEqual({
      id: { in: [V60, V120] },
    });
  });
});
