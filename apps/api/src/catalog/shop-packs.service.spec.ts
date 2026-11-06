import { MediaStorage } from '../media/media-storage';
import { PrismaService } from '../prisma/prisma.service';
import { ShopPacksService } from './shop-packs.service';

const V60 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const V120 = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const FILE_KEY = 'b1c2d3e4-5f60-4a7b-8c9d-0e1f2a3b4c5d';

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
      name: 'Ashwagandha Capsules',
      slug: 'ashwagandha-capsules',
      isActive: true,
      category: { isActive: true },
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
  it('finds a pack size by its SKU, with its product, its photo and every size of the product', async () => {
    const { packs, prisma } = setup();

    await expect(packs.findBySku('ASH-CAP-60')).resolves.toEqual({
      variantId: V60,
      productVariantIds: [V60, V120],
      sku: 'ASH-CAP-60',
      quantity: 60,
      unit: 'CAPSULES',
      mrpRupees: 500,
      priceRupees: 449,
      onSale: true,
      product: {
        name: 'Ashwagandha Capsules',
        slug: 'ashwagandha-capsules',
        imageUrl: `http://media/products/${FILE_KEY}-small.webp`,
      },
    });
    expect(prisma.productVariant.findUnique.mock.calls[0][0].where).toEqual({
      sku: 'ASH-CAP-60',
    });
  });

  it('is not sold now when the pack is off sale, or its product or category is hidden', async () => {
    const { packs, prisma } = setup();
    prisma.productVariant.findUnique
      .mockResolvedValueOnce(row({ isActive: false }))
      .mockResolvedValueOnce(row({}, { isActive: false }))
      .mockResolvedValueOnce(row({}, { category: { isActive: false } }));

    for (let i = 0; i < 3; i++) {
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
