import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { StockService } from '../inventory/stock.service';
import { MediaStorage } from '../media/media-storage';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from './products.service';

const ID = '3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e';
const CATEGORY = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const BRAND = '3f6c1a2e-9b4d-4c7e-8a15-6d2f0e9b7c41';
const BASE = 'http://127.0.0.1:3000/media';
const KEY = 'b1c2d3e4-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER_KEY = 'c2d3e4f5-6071-4b8c-9d0e-1f2a3b4c5d6e';
const createdAt = new Date('2026-11-04T09:15:00.000Z');
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};

// What staff set, as a draft without the details.
const draftFields = {
  categoryId: CATEGORY,
  brandId: null,
  name: 'Ashwagandha Capsules',
  slug: 'ashwagandha-capsules',
  summary: null,
  description: null,
  ingredients: null,
  usage: null,
  type: null,
  licenceNumber: null,
  manufacturerName: null,
  manufacturerAddress: null,
  countryOfOrigin: 'India',
  hsnCode: null,
  gstRate: null,
  isActive: false,
  position: 0,
};
const details = {
  type: 'AYURVEDIC_MEDICINE' as const,
  licenceNumber: '25D/123/2015',
  manufacturerName: 'Herbal Works Pvt Ltd',
  manufacturerAddress: '12, Industrial Area, Mysuru 570016',
  ingredients: 'Each capsule contains: Ashwagandha root extract 500 mg',
  hsnCode: '3004',
  gstRate: 5,
};

// A product as the query returns it.
function storedRow(changes: object = {}) {
  return {
    id: ID,
    ...draftFields,
    otherCategories: [],
    createdAt,
    updatedAt: createdAt,
    ...changes,
  };
}
// The same product as staff see it: with the IDs of its other categories
// (part 15A).
function stored(changes: object = {}) {
  return {
    id: ID,
    ...draftFields,
    otherCategoryIds: [],
    createdAt,
    updatedAt: createdAt,
    ...changes,
  };
}
const shopCategory = {
  name: 'Herbal Supplements',
  slug: 'herbal-supplements',
  description: null,
};
const withCode = (code: string) =>
  Object.assign(new Error('Prisma error'), { code });

function setup(products: object[] = []) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: ID }]),
    product: {
      create: jest.fn().mockResolvedValue(storedRow()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(storedRow()),
      update: jest.fn().mockResolvedValue(storedRow({ name: 'Renamed' })),
      delete: jest.fn().mockResolvedValue({ id: ID }),
    },
    productVariant: { findMany: jest.fn().mockResolvedValue([]) },
    productImage: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([]),
    },
    productCategory: {
      update: jest.fn().mockResolvedValue({ productId: ID }),
    },
  };
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    product: {
      findMany: jest.fn().mockResolvedValue(products),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(storedRow()),
    },
    category: {
      findFirst: jest.fn().mockResolvedValue(shopCategory),
      findUnique: jest.fn().mockResolvedValue({ id: CATEGORY }),
    },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const media = {
    url: jest.fn((name: string) => `${BASE}/${name}`),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const stock = { inStock: jest.fn().mockResolvedValue(new Set()) };
  const logger = { info: jest.fn(), warn: jest.fn() };
  const service = new ProductsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    media as unknown as MediaStorage,
    stock as unknown as StockService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, audit, media, stock, logger };
}

// The errors a refused change answers with, field by field.
async function refusal(promise: Promise<unknown>) {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  return (error as BadRequestException).getResponse();
}

describe('ProductsService.list', () => {
  it('pages through every product, drafts too, in the order customers see them', async () => {
    const { service, prisma } = setup([storedRow()]);

    await expect(service.list({ limit: 50 })).resolves.toEqual({
      products: [stored()],
      nextAfter: null,
    });

    const [query] = prisma.product.findMany.mock.calls[0] as [
      {
        where: object;
        orderBy: object;
        take: number;
        cursor?: object;
        select: Record<string, unknown>;
      },
    ];
    expect(query.where).toEqual({ categoryId: undefined, isActive: undefined });
    expect(query.orderBy).toEqual([
      { position: 'asc' },
      { name: 'asc' },
      { id: 'asc' },
    ]);
    expect(query.take).toBe(51);
    expect(query.cursor).toBeUndefined();
    expect(Object.keys(query.select).sort()).toEqual(
      [
        'id',
        ...Object.keys(draftFields),
        'createdAt',
        'updatedAt',
        'otherCategories',
      ].sort(),
    );
    // The other categories it is also shown in, by ID (part 15A).
    expect(query.select.otherCategories).toEqual({
      orderBy: { categoryId: 'asc' },
      select: { categoryId: true },
    });
  });

  it('filters, continues after a product, and says where the next page starts', async () => {
    const { service, prisma } = setup([
      storedRow({ id: 'a' }),
      storedRow({ id: 'b' }),
      storedRow({ id: 'c' }),
    ]);

    await expect(
      service.list({ limit: 2, after: ID, categoryId: CATEGORY, isActive: true }),
    ).resolves.toEqual({
      products: [stored({ id: 'a' }), stored({ id: 'b' })],
      nextAfter: 'b',
    });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { categoryId: CATEGORY, isActive: true },
        take: 3,
        cursor: { id: ID },
        skip: 1,
      }),
    );
  });
});

describe('ProductsService.create', () => {
  it('saves the product last in its category, and records everything staff set, in the same transaction', async () => {
    const { service, tx, audit, logger } = setup();
    tx.$queryRaw.mockResolvedValue([{ id: CATEGORY, position: 3 }]);
    const input = { categoryId: CATEGORY, name: 'Ashwagandha Capsules', slug: 'ashwagandha-capsules' };

    await expect(service.create(input, context)).resolves.toEqual(stored());

    // Last among its own products and those also shown there (part 15A),
    // with the category kept while the product is saved.
    const { sql, values } = rawCall(tx.$queryRaw);
    expect(sql).toMatch(
      /FROM "categories" c\s+WHERE c\."id" = ANY\(\?::uuid\[\]\)\s+ORDER BY c\."id"\s+FOR KEY SHARE OF c/,
    );
    expect(values).toEqual([[CATEGORY]]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.product.create.mock.invocationCallOrder[0],
    );
    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ...input, position: 3, otherCategories: { create: [] } },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'product.created',
      targetType: 'product',
      targetId: ID,
      after: { ...draftFields, otherCategoryIds: [] },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { productId: ID, actorId: context.actorId },
      'Product created',
    );
  });

  it('keeps the place given, asking nothing about the category', async () => {
    const { service, tx } = setup();
    const input = {
      categoryId: CATEGORY,
      name: 'Tulsi Tea',
      slug: 'tulsi-tea',
      position: 0,
    };

    await service.create(input, context);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ...input, otherCategories: { create: [] } },
      }),
    );
  });

  it('answers 400 on categoryId when the category to put it last in does not exist', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      refusal(
        service.create(
          { categoryId: CATEGORY, name: 'Tulsi Tea', slug: 'tulsi-tea' },
          context,
        ),
      ),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [{ field: 'categoryId', message: 'No category with this ID' }],
    });
    expect(tx.product.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('answers 409 when another product has the slug', async () => {
    const { service, tx, audit } = setup();
    tx.product.create.mockRejectedValue(withCode('P2002'));

    await expect(
      service.create(
        {
          categoryId: CATEGORY,
          name: 'Tulsi Tea',
          slug: 'tulsi-tea',
          position: 0,
        },
        context,
      ),
    ).rejects.toThrow(
      new ConflictException(
        'Another product already has this slug. Choose a different one.',
      ),
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('answers 400 on categoryId when the category does not exist', async () => {
    const { service, tx, audit } = setup();
    tx.product.create.mockRejectedValue(withCode('P2003'));

    await expect(
      refusal(
        service.create(
          {
            categoryId: CATEGORY,
            name: 'Tulsi Tea',
            slug: 'tulsi-tea',
            position: 0,
          },
          context,
        ),
      ),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [{ field: 'categoryId', message: 'No category with this ID' }],
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('passes on any other error unchanged', async () => {
    const { service, tx } = setup();
    const broken = new Error('connection lost');
    tx.product.create.mockRejectedValue(broken);

    await expect(
      service.create(
        {
          categoryId: CATEGORY,
          name: 'Tulsi Tea',
          slug: 'tulsi-tea',
          position: 0,
        },
        context,
      ),
    ).rejects.toBe(broken);
  });
});

describe('ProductsService.update', () => {
  it('locks the product first, so the rules and the audit entry see it as it is', async () => {
    const { service, tx } = setup();

    await service.update(ID, { name: 'Renamed' }, context);

    const [sql, id] = tx.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join('?')).toMatch(/FROM products WHERE id = \?::uuid FOR UPDATE/);
    expect(id).toBe(ID);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.product.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
  });

  it('saves only the fields that change, and records them before and after', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(
      service.update(ID, { name: 'Renamed', position: 0, summary: 'Calm' }, context),
    ).resolves.toEqual(stored({ name: 'Renamed' }));

    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ID },
        data: { name: 'Renamed', summary: 'Calm' },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'product.updated',
      targetType: 'product',
      targetId: ID,
      before: { name: 'Ashwagandha Capsules', summary: null },
      after: { name: 'Renamed', summary: 'Calm' },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { productId: ID, actorId: context.actorId },
      'Product changed',
    );
  });

  it('refuses to activate a draft that lacks details, naming each one', async () => {
    const { service, tx, audit } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(
      storedRow({ ...details, ingredients: null, manufacturerAddress: null }),
    );

    await expect(
      refusal(service.update(ID, { isActive: true }, context)),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [
        { field: 'manufacturerAddress', message: 'Needed before the product can go live' },
        { field: 'ingredients', message: 'Needed before the product can go live' },
      ],
    });
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('activates a complete product, and adds the missing details and activates in one change', async () => {
    const { service, tx } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(storedRow(details));

    await service.update(ID, { isActive: true }, context);
    expect(tx.product.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { isActive: true } }),
    );

    tx.product.findUniqueOrThrow.mockResolvedValue(storedRow());
    await service.update(ID, { ...details, isActive: true }, context);
    expect(tx.product.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { ...details, isActive: true } }),
    );
  });

  it('refuses to activate a product without an image, counted while it is locked', async () => {
    const { service, tx, audit } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(storedRow(details));
    tx.productImage.count.mockResolvedValue(0);

    await expect(
      refusal(service.update(ID, { isActive: true }, context)),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [
        { field: 'images', message: 'Needed before the product can go live' },
      ],
    });
    expect(tx.productImage.count).toHaveBeenCalledWith({
      where: { productId: ID },
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.productImage.count.mock.invocationCallOrder[0],
    );
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();

    // A draft may still change without an image.
    await service.update(ID, { name: 'Renamed' }, context);
    expect(tx.product.update).toHaveBeenCalledTimes(1);
  });

  it('refuses to remove a detail from a live product', async () => {
    const { service, tx } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(storedRow({ ...details, isActive: true }));

    await expect(
      refusal(service.update(ID, { licenceNumber: null }, context)),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [
        { field: 'licenceNumber', message: 'Needed before the product can go live' },
      ],
    });
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('checks the licence against the type the product will have', async () => {
    const { service, tx } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(storedRow(details));

    await expect(
      refusal(service.update(ID, { type: 'FOOD_OR_SUPPLEMENT' }, context)),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [
        { field: 'licenceNumber', message: 'An FSSAI licence number has exactly 14 digits' },
      ],
    });
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('changes and records nothing when every value is already the same', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(
      service.update(ID, { name: 'Ashwagandha Capsules', isActive: false }, context),
    ).resolves.toEqual(stored());

    expect(tx.product.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown ID, and changes nothing', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      service.update(ID, { name: 'Renamed' }, context),
    ).rejects.toThrow(new NotFoundException('Product not found'));
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('answers 409 for a taken slug, and 400 for a category that does not exist', async () => {
    const { service, tx, audit } = setup();
    tx.product.update.mockRejectedValueOnce(withCode('P2002'));
    await expect(
      service.update(ID, { slug: 'tulsi-tea' }, context),
    ).rejects.toBeInstanceOf(ConflictException);

    tx.product.update.mockRejectedValueOnce(withCode('P2003'));
    await expect(
      refusal(
        service.update(
          ID,
          { categoryId: '00000000-0000-4000-8000-000000000000', position: 0 },
          context,
        ),
      ),
    ).resolves.toMatchObject({
      errors: [{ field: 'categoryId', message: 'No category with this ID' }],
    });
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('ProductsService.remove', () => {
  it('locks the product, deletes it, and records what it was, pack sizes and images included, in the same transaction', async () => {
    const { service, tx, audit, media, logger } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(storedRow({ ...details, isActive: true }));
    const packs = [
      { sku: 'ASH-CAP-60', quantity: 60, unit: 'CAPSULES', mrpRupees: 500, priceRupees: 450, isActive: true },
    ];
    tx.productVariant.findMany.mockResolvedValue(packs);
    const images = [
      { fileKey: KEY, width: 800, height: 600, altText: null, position: 0 },
      { fileKey: OTHER_KEY, width: 600, height: 800, altText: 'Back label', position: 1 },
    ];
    tx.productImage.findMany.mockResolvedValue(images);

    await expect(service.remove(ID, context)).resolves.toBeUndefined();

    const [sql, id] = tx.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join('?')).toMatch(/FROM products WHERE id = \?::uuid FOR UPDATE/);
    expect(id).toBe(ID);
    expect(tx.product.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID } }),
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.product.delete.mock.invocationCallOrder[0],
    );
    // The pack sizes are read before the delete takes them with it.
    expect(tx.productVariant.findMany).toHaveBeenCalledWith({
      where: { productId: ID },
      orderBy: [{ position: 'asc' }, { quantity: 'asc' }, { id: 'asc' }],
      select: {
        sku: true,
        quantity: true,
        unit: true,
        mrpRupees: true,
        priceRupees: true,
        isActive: true,
      },
    });
    expect(tx.productVariant.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.product.delete.mock.invocationCallOrder[0],
    );
    // The images too, main photo first.
    expect(tx.productImage.findMany).toHaveBeenCalledWith({
      where: { productId: ID },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        fileKey: true,
        width: true,
        height: true,
        altText: true,
        position: true,
      },
    });
    expect(tx.productImage.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.product.delete.mock.invocationCallOrder[0],
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'product.deleted',
      targetType: 'product',
      targetId: ID,
      before: {
        ...draftFields,
        ...details,
        isActive: true,
        otherCategoryIds: [],
        variants: packs,
        images,
      },
    });
    // Their files go once the deletion is saved.
    expect(media.remove.mock.calls).toEqual([
      [`products/${KEY}-large.webp`],
      [`products/${KEY}-small.webp`],
      [`products/${OTHER_KEY}-large.webp`],
      [`products/${OTHER_KEY}-small.webp`],
    ]);
    expect(audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      media.remove.mock.invocationCallOrder[0],
    );
    expect(logger.info).toHaveBeenCalledWith(
      { productId: ID, actorId: context.actorId },
      'Product deleted',
    );
  });

  it('answers 404 for an unknown ID, and deletes nothing', async () => {
    const { service, tx, audit, media, logger } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(service.remove(ID, context)).rejects.toThrow(
      new NotFoundException('Product not found'),
    );
    expect(tx.product.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(media.remove).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('answers 409 when a pack size still holds stock, which the database refuses to delete', async () => {
    const { service, tx, media, logger } = setup();
    tx.productImage.findMany.mockResolvedValue([
      { fileKey: KEY, width: 800, height: 600, altText: null, position: 0 },
    ]);
    tx.product.delete.mockRejectedValue(
      Object.assign(new Error('Prisma error'), { code: 'P2003' }),
    );

    await expect(service.remove(ID, context)).rejects.toThrow(
      new ConflictException(
        'This product still has stock. Write it off first, then delete it.',
      ),
    );
    expect(media.remove).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('keeps the files when the deletion fails', async () => {
    const { service, tx, media } = setup();
    tx.productImage.findMany.mockResolvedValue([
      { fileKey: KEY, width: 800, height: 600, altText: null, position: 0 },
    ]);
    tx.product.delete.mockRejectedValue(new Error('Database unavailable'));

    await expect(service.remove(ID, context)).rejects.toThrow(
      'Database unavailable',
    );
    expect(media.remove).not.toHaveBeenCalled();
  });

  it('still deletes the product when a file cannot be deleted, and logs it', async () => {
    const { service, tx, media, logger } = setup();
    tx.productImage.findMany.mockResolvedValue([
      { fileKey: KEY, width: 800, height: 600, altText: null, position: 0 },
    ]);
    media.remove.mockRejectedValue(new Error('Disk unavailable'));

    await expect(service.remove(ID, context)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: new Error('Disk unavailable'), fileKey: KEY },
      'Image files not deleted',
    );
    expect(logger.info).toHaveBeenCalledWith(
      { productId: ID, actorId: context.actorId },
      'Product deleted',
    );
  });
});

describe('ProductsService.listForShop', () => {
  // A product as the query returns it, with its cheapest pack on sale, if
  // any, and its main photo.
  const row = (slug: string, priceRupees?: number) => ({
    id: `id-${slug}`,
    name: slug,
    slug,
    summary: null,
    variants: priceRupees ? [{ priceRupees }] : [],
    images: [{ fileKey: KEY }],
  });
  // The same product as a customer sees its card: without its ID.
  const card = (slug: string, fromPriceRupees: number | null = null) => ({
    name: slug,
    slug,
    summary: null,
    fromPriceRupees,
    imageUrl: `${BASE}/products/${KEY}-small.webp`,
  });
  // The products of the page, in order, as the first query lists them.
  const listed = (...slugs: string[]) =>
    slugs.map((slug) => ({ id: `id-${slug}` }));

  function shopSetup(rows: object[], ids: { id: string }[]) {
    const ready = setup(rows);
    ready.prisma.category.findFirst.mockResolvedValue({
      id: CATEGORY,
      ...shopCategory,
    });
    ready.prisma.$queryRaw.mockResolvedValue(ids);
    return ready;
  }

  it("shows a category customers see, without its ID, and one page of the products shown in it, in order: a card's fields and the lowest price", async () => {
    // The rows come back in any order: the page keeps the listed one.
    const { service, prisma } = shopSetup(
      [row('b'), row('a', 450)],
      listed('a', 'b'),
    );

    await expect(
      service.listForShop('herbal-supplements', { limit: 20 }),
    ).resolves.toEqual({
      category: shopCategory,
      products: [card('a', 450), card('b')],
      nextAfter: null,
    });
    // Active, and when a subcategory, inside an active top category. With
    // the top category it sits in, or its active subcategories (part 15A).
    expect(prisma.category.findFirst).toHaveBeenCalledWith({
      where: {
        slug: 'herbal-supplements',
        isActive: true,
        OR: [{ parentId: null }, { parent: { isActive: true } }],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        parent: { select: { name: true, slug: true } },
        subcategories: {
          where: { isActive: true },
          orderBy: [{ position: 'asc' }, { name: 'asc' }, { id: 'asc' }],
          select: { name: true, slug: true, description: true },
        },
      },
    });
    // Its own live products, and the live ones also shown in it, each at
    // its place here (part 15A). A subcategory's are on its own page.
    const { sql, values } = rawCall(prisma.$queryRaw);
    expect(sql).toContain('WHERE p."categoryId" = ?::uuid AND p."isActive"');
    expect(sql).toContain('SELECT p."id", p."slug", p."name", o."position"');
    expect(sql).toContain('WHERE o."categoryId" = ?::uuid AND p."isActive"');
    // Shown from another category only while its main category is shown.
    expect(sql).toContain(
      'AND c."isActive" AND (top."id" IS NULL OR top."isActive")',
    );
    expect(sql).toMatch(/ORDER BY "position", "name", "id"\s+LIMIT \?/);
    // Every value is bound: the category twice, no page to continue after,
    // one more than asked for.
    expect(values).toEqual([CATEGORY, CATEGORY, null, null, 21]);
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['id-a', 'id-b'] }, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        summary: true,
        // Only the cheapest pack on sale.
        variants: {
          where: { isActive: true },
          orderBy: { priceRupees: 'asc' },
          take: 1,
          select: { priceRupees: true },
        },
        // Only the main photo.
        images: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { fileKey: true },
        },
      },
    });
  });

  it('shows no image address for a product without images', async () => {
    const { service } = shopSetup([{ ...row('a'), images: [] }], listed('a'));

    await expect(
      service.listForShop('herbal-supplements', { limit: 20 }),
    ).resolves.toMatchObject({ products: [{ ...card('a'), imageUrl: null }] });
  });

  it('continues after the slug of the last product shown, and says where the next page starts', async () => {
    const { service, prisma } = shopSetup(
      [row('c'), row('b')],
      listed('b', 'c', 'd'),
    );

    await expect(
      service.listForShop('herbal-supplements', { limit: 2, after: 'a' }),
    ).resolves.toMatchObject({
      products: [card('b'), card('c')],
      nextAfter: 'c',
    });
    const { sql, values } = rawCall(prisma.$queryRaw);
    expect(sql).toMatch(
      /\("position", "name", "id"\) >\s+\(SELECT "position", "name", "id" FROM listed\s+WHERE "slug" = \?::text\)/,
    );
    expect(values).toEqual([CATEGORY, CATEGORY, 'a', 'a', 3]);
    // Only the page's products are read, not the one after it.
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['id-b', 'id-c'] }, isActive: true },
      }),
    );
  });

  it('has no next page when exactly as many as asked for are listed', async () => {
    const { service } = shopSetup([row('a'), row('b')], listed('a', 'b'));

    await expect(
      service.listForShop('herbal-supplements', { limit: 2 }),
    ).resolves.toMatchObject({ nextAfter: null });
  });

  it('leaves out a product hidden or deleted between the two queries', async () => {
    const { service } = shopSetup([row('a')], listed('a', 'b'));

    await expect(
      service.listForShop('herbal-supplements', { limit: 20 }),
    ).resolves.toMatchObject({ products: [card('a')], nextAfter: null });
  });

  it('answers 404 for a hidden or unknown category, and looks for no products', async () => {
    const { service, prisma } = setup();
    prisma.category.findFirst.mockResolvedValue(null);

    await expect(
      service.listForShop('hidden-category', { limit: 20 }),
    ).rejects.toThrow(new NotFoundException('Category not found'));
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});

describe('ProductsService.findForShop', () => {
  it("shows an active product of a category customers see, with its licence and maker details", async () => {
    const { service, prisma } = setup();
    const page = {
      name: 'Ashwagandha Capsules',
      slug: 'ashwagandha-capsules',
      variants: [],
      images: [],
    };
    prisma.product.findFirst.mockResolvedValue(page);

    await expect(service.findForShop('ashwagandha-capsules')).resolves.toEqual(
      page,
    );

    const [query] = prisma.product.findFirst.mock.calls[0] as [
      { where: object; select: Record<string, unknown> },
    ];
    expect(query.where).toEqual({
      slug: 'ashwagandha-capsules',
      isActive: true,
      category: {
        isActive: true,
        OR: [{ parentId: null }, { parent: { isActive: true } }],
      },
    });
    expect(Object.keys(query.select).sort()).toEqual([
      'brand',
      'category',
      'countryOfOrigin',
      'description',
      'images',
      'ingredients',
      'licenceNumber',
      'manufacturerAddress',
      'manufacturerName',
      'name',
      'slug',
      'summary',
      'type',
      'usage',
      'variants',
    ]);
    // With the top category it sits in, null for a top category (part 15A).
    expect(query.select.category).toEqual({
      select: {
        name: true,
        slug: true,
        parent: { select: { name: true, slug: true } },
      },
    });
    // Its brand by name and slug, null when it has none (part 15A).
    expect(query.select.brand).toEqual({ select: { name: true, slug: true } });
    // Only the packs on sale. The ID is read only to ask about stock.
    expect(query.select.variants).toEqual({
      where: { isActive: true },
      orderBy: [{ position: 'asc' }, { quantity: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        sku: true,
        quantity: true,
        unit: true,
        mrpRupees: true,
        priceRupees: true,
      },
    });
  });

  it('shows its images, main photo first, by the addresses of their files, with a description', async () => {
    const { service, prisma } = setup();
    prisma.product.findFirst.mockResolvedValue({
      name: 'Ashwagandha Capsules',
      slug: 'ashwagandha-capsules',
      variants: [],
      images: [
        { fileKey: KEY, width: 800, height: 600, altText: null },
        { fileKey: OTHER_KEY, width: 600, height: 800, altText: 'Back label' },
      ],
    });

    await expect(service.findForShop('ashwagandha-capsules')).resolves.toEqual({
      name: 'Ashwagandha Capsules',
      slug: 'ashwagandha-capsules',
      variants: [],
      images: [
        {
          url: `${BASE}/products/${KEY}-large.webp`,
          thumbnailUrl: `${BASE}/products/${KEY}-small.webp`,
          // No description from staff: the product's name.
          altText: 'Ashwagandha Capsules',
          width: 800,
          height: 600,
        },
        {
          url: `${BASE}/products/${OTHER_KEY}-large.webp`,
          thumbnailUrl: `${BASE}/products/${OTHER_KEY}-small.webp`,
          altText: 'Back label',
          width: 600,
          height: 800,
        },
      ],
    });
    const [query] = prisma.product.findFirst.mock.calls[0] as [
      { select: Record<string, unknown> },
    ];
    // The key is read, but never shown on its own: no IDs in the shop.
    expect(query.select.images).toEqual({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { fileKey: true, width: true, height: true, altText: true },
    });
  });

  it('says for each pack on sale whether it is in stock, by its SKU, never by its ID', async () => {
    const { service, prisma, stock } = setup();
    const pack = (id: string, sku: string, quantity: number) => ({
      id, sku, quantity, unit: 'CAPSULES', mrpRupees: 500, priceRupees: 450,
    });
    prisma.product.findFirst.mockResolvedValue({
      name: 'Ashwagandha Capsules',
      variants: [pack('v-60', 'ASH-CAP-60', 60), pack('v-120', 'ASH-CAP-120', 120)],
      images: [],
    });
    stock.inStock.mockResolvedValue(new Set(['v-120']));

    const page = await service.findForShop('ashwagandha-capsules');

    expect(stock.inStock).toHaveBeenCalledWith(['v-60', 'v-120']);
    expect(page.variants).toEqual([
      { sku: 'ASH-CAP-60', quantity: 60, unit: 'CAPSULES', mrpRupees: 500, priceRupees: 450, inStock: false },
      { sku: 'ASH-CAP-120', quantity: 120, unit: 'CAPSULES', mrpRupees: 500, priceRupees: 450, inStock: true },
    ]);
  });

  it('answers 404 for a hidden or unknown product', async () => {
    const { service } = setup();

    await expect(service.findForShop('draft-product')).rejects.toThrow(
      new NotFoundException('Product not found'),
    );
  });
});

const SECOND = '4a3c9d2e-6f7b-4c8d-9e0f-1a2b3c4d5e6f';
const THIRD = '5b4d0e3f-7081-4d9e-8f10-2b3c4d5e6f70';
const OTHER_PRODUCT = '6c5e1f40-8192-4eaf-9021-3c4d5e6f7081';

// The SQL text and the values bound to it, from a tagged-template call.
function rawCall(mock: jest.Mock, index = 0) {
  const [strings, ...values] = mock.mock.calls[index] as [
    TemplateStringsArray,
    ...unknown[],
  ];
  return { sql: strings.join('?'), values };
}

describe('ProductsService.findForStaff', () => {
  it('reads one product, drafts too, with every staff field', async () => {
    const { service, prisma } = setup();

    await expect(service.findForStaff(ID)).resolves.toEqual(stored());

    const [query] = prisma.product.findUnique.mock.calls[0] as [
      { where: object; select: Record<string, boolean> },
    ];
    expect(query.where).toEqual({ id: ID });
    expect(query.select).toMatchObject({
      id: true,
      hsnCode: true,
      isActive: true,
    });
  });

  it('answers 404 for an unknown ID', async () => {
    const { service, prisma } = setup();
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(service.findForStaff(ID)).rejects.toThrow(
      new NotFoundException('Product not found'),
    );
  });
});

describe('ProductsService.list with search words', () => {
  it('finds by name with trigrams, drafts too, the best first, on one page', async () => {
    const { service, prisma } = setup();
    prisma.$queryRaw.mockResolvedValue([{ id: SECOND }, { id: ID }]);
    prisma.product.findMany.mockResolvedValue([
      storedRow(),
      storedRow({ id: SECOND, name: 'Ashwagandha Powder' }),
    ]);

    const page = await service.list({ q: 'ashwa', limit: 50 });

    // In the order of the matches, not the order the rows came back in.
    expect(page.products.map((product) => product.id)).toEqual([SECOND, ID]);
    expect(page.nextAfter).toBeNull();
    const { sql, values } = rawCall(prisma.$queryRaw);
    expect(sql).toContain('<% p."name"');
    // By the name only, best match first, unlike the shop's search.
    expect(sql).not.toMatch(/summary|description|ingredients/);
    expect(sql).toMatch(/ORDER BY word_similarity\(\?, p\."name"\) DESC/);
    // Every value is bound: the words, no category, no brand, any status,
    // the limit.
    expect(values).toEqual([
      'ashwa',
      null,
      null,
      null,
      null,
      null,
      null,
      'ashwa',
      50,
    ]);
    expect(sql).not.toContain('ashwa');
    const [query] = prisma.product.findMany.mock.calls[0] as [
      { where: object },
    ];
    expect(query.where).toEqual({ id: { in: [SECOND, ID] } });
  });

  it('keeps the category, brand and status filters, as bound values', async () => {
    const { service, prisma } = setup();

    await service.list({
      q: 'tulsi',
      limit: 10,
      categoryId: CATEGORY,
      brandId: BRAND,
      isActive: false,
    });

    const { sql, values } = rawCall(prisma.$queryRaw);
    expect(sql).toContain('p."brandId" = ?::uuid');
    expect(values).toEqual([
      'tulsi',
      CATEGORY,
      CATEGORY,
      BRAND,
      BRAND,
      false,
      false,
      'tulsi',
      10,
    ]);
  });

  it('leaves out a product deleted between the two queries', async () => {
    const { service, prisma } = setup();
    prisma.$queryRaw.mockResolvedValue([{ id: SECOND }, { id: ID }]);
    prisma.product.findMany.mockResolvedValue([storedRow()]);

    const page = await service.list({ q: 'ashwa', limit: 50 });

    expect(page.products.map((product) => product.id)).toEqual([ID]);
  });

  it('pages as before without search words, and asks no raw query', async () => {
    const { service, prisma } = setup([storedRow()]);

    await service.list({ limit: 50 });

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('ProductsService.reorder', () => {
  const rows = (positions: Record<string, number>) =>
    Object.entries(positions).map(([id, position]) => ({ id, position }));

  // Its own products, and those also shown in it (part 15A), each with its
  // place there.
  function reorderSetup(
    positions: Record<string, number>,
    shown: Record<string, number> = {},
  ) {
    const ready = setup([storedRow()]);
    ready.tx.$queryRaw
      .mockResolvedValueOnce([{ id: CATEGORY }])
      .mockResolvedValueOnce(rows(positions))
      .mockResolvedValueOnce(rows(shown));
    // The answer: every product shown in it, in the new order.
    ready.prisma.$queryRaw.mockResolvedValue([{ id: ID }]);
    return ready;
  }

  it('gives each product its place in the list, and records each one that moved', async () => {
    const { service, tx, audit, prisma } = reorderSetup({
      [ID]: 0,
      [SECOND]: 1,
      [THIRD]: 2,
    });

    await expect(
      service.reorder(
        { categoryId: CATEGORY, ids: [SECOND, ID, THIRD] },
        context,
      ),
    ).resolves.toEqual({ products: [stored()] });

    expect(tx.product.update.mock.calls).toEqual([
      [{ where: { id: SECOND }, data: { position: 0 }, select: { id: true } }],
      [{ where: { id: ID }, data: { position: 1 }, select: { id: true } }],
    ]);
    expect(audit.record.mock.calls.map(([, entry]) => entry)).toEqual([
      {
        ...context,
        action: 'product.updated',
        targetType: 'product',
        targetId: SECOND,
        before: { position: 1 },
        after: { position: 0 },
      },
      {
        ...context,
        action: 'product.updated',
        targetType: 'product',
        targetId: ID,
        before: { position: 0 },
        after: { position: 1 },
      },
    ]);
    // The answer is every product shown in the category, in the new
    // order.
    const answer = rawCall(prisma.$queryRaw);
    expect(answer.sql).toContain('FROM "product_categories" o');
    expect(answer.sql).toContain('ORDER BY "position", "name", "id"');
    expect(answer.values).toEqual([CATEGORY, CATEGORY]);
    const [query] = prisma.product.findMany.mock.calls[0] as [
      { where: object },
    ];
    expect(query.where).toEqual({ id: { in: [ID] } });
  });

  it('places the products also shown in it among its own, each at its place there, and records each move (part 15A)', async () => {
    const { service, tx, audit } = reorderSetup(
      { [ID]: 0 },
      { [SECOND]: 1 },
    );

    await service.reorder({ categoryId: CATEGORY, ids: [SECOND, ID] }, context);

    expect(tx.productCategory.update.mock.calls).toEqual([
      [
        {
          where: {
            productId_categoryId: { productId: SECOND, categoryId: CATEGORY },
          },
          data: { position: 0 },
          select: { productId: true },
        },
      ],
    ]);
    expect(tx.product.update.mock.calls).toEqual([
      [{ where: { id: ID }, data: { position: 1 }, select: { id: true } }],
    ]);
    expect(audit.record.mock.calls.map(([, entry]) => entry)).toEqual([
      {
        ...context,
        action: 'product.updated',
        targetType: 'product',
        targetId: SECOND,
        before: { otherCategoryPosition: { categoryId: CATEGORY, position: 1 } },
        after: { otherCategoryPosition: { categoryId: CATEGORY, position: 0 } },
      },
      {
        ...context,
        action: 'product.updated',
        targetType: 'product',
        targetId: ID,
        before: { position: 0 },
        after: { position: 1 },
      },
    ]);
  });

  it('locks the category, then its products in the order of their IDs, before reading positions', async () => {
    const { service, tx } = reorderSetup({ [ID]: 0 });

    await service.reorder({ categoryId: CATEGORY, ids: [ID] }, context);

    const category = rawCall(tx.$queryRaw, 0);
    expect(category.sql).toContain('FOR KEY SHARE');
    expect(category.values).toEqual([CATEGORY]);
    const products = rawCall(tx.$queryRaw, 1);
    expect(products.sql).toMatch(/ORDER BY id FOR NO KEY UPDATE/);
    expect(products.values).toEqual([CATEGORY]);
    // Then the products also shown in it, by their IDs too (part 15A).
    const shown = rawCall(tx.$queryRaw, 2);
    expect(shown.sql).toMatch(
      /FROM product_categories\s+WHERE "categoryId" = \?::uuid\s+ORDER BY "productId" FOR NO KEY UPDATE/,
    );
    expect(shown.values).toEqual([CATEGORY]);
  });

  it('changes and records nothing when the order is the same', async () => {
    const { service, tx, audit, logger } = reorderSetup(
      { [ID]: 0, [SECOND]: 1 },
      { [THIRD]: 2 },
    );

    await service.reorder(
      { categoryId: CATEGORY, ids: [ID, SECOND, THIRD] },
      context,
    );

    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.productCategory.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each([
    ['a product is missing', [ID, THIRD]],
    ['a product also shown in it is missing', [ID, SECOND]],
    ['a product is not in the category', [ID, SECOND, THIRD, OTHER_PRODUCT]],
  ])('answers 409 and changes nothing when %s', async (_case, ids) => {
    const { service, tx, audit } = reorderSetup(
      { [ID]: 0, [SECOND]: 1 },
      { [THIRD]: 0 },
    );

    await expect(
      service.reorder({ categoryId: CATEGORY, ids }, context),
    ).rejects.toThrow(ConflictException);
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('answers 400 on categoryId for a category that does not exist', async () => {
    const { service, tx } = setup();
    tx.$queryRaw.mockResolvedValueOnce([]);

    await expect(
      refusal(service.reorder({ categoryId: CATEGORY, ids: [ID] }, context)),
    ).resolves.toMatchObject({
      errors: [{ field: 'categoryId', message: 'No category with this ID' }],
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

// Part 15A: a product may have a brand from the list, or none.
describe('ProductsService brands', () => {
  const brandCheck = /FROM brands WHERE id = \?::uuid FOR KEY SHARE/;

  it('filters the staff list by brand', async () => {
    const { service, prisma } = setup([storedRow()]);

    await service.list({ limit: 50, brandId: BRAND });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { categoryId: undefined, brandId: BRAND, isActive: undefined },
      }),
    );
  });

  it('saves a new product with a brand that exists, checked and kept while it is saved', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw.mockResolvedValue([{ id: BRAND }]);
    tx.product.create.mockResolvedValue(storedRow({ brandId: BRAND }));
    const input = {
      categoryId: CATEGORY,
      brandId: BRAND,
      name: 'Ashwagandha Capsules',
      slug: 'ashwagandha-capsules',
      position: 0,
    };

    await service.create(input, context);

    const { sql, values } = rawCall(tx.$queryRaw);
    expect(sql).toMatch(brandCheck);
    // A parameter, never pasted into the SQL.
    expect(values).toEqual([BRAND]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.product.create.mock.invocationCallOrder[0],
    );
    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ...input, otherCategories: { create: [] } },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        after: expect.objectContaining({ brandId: BRAND }) as object,
      }),
    );
  });

  it('answers 400 on brandId for a brand that does not exist, and saves nothing', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      refusal(
        service.create(
          {
            categoryId: CATEGORY,
            brandId: BRAND,
            name: 'Tulsi Tea',
            slug: 'tulsi-tea',
            position: 0,
          },
          context,
        ),
      ),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [{ field: 'brandId', message: 'No brand with this ID' }],
    });
    expect(tx.product.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('asks nothing about brands for a new product without one', async () => {
    const { service, tx } = setup();

    await service.create(
      {
        categoryId: CATEGORY,
        name: 'Tulsi Tea',
        slug: 'tulsi-tea',
        position: 0,
      },
      context,
    );

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('checks a new brand once the product is locked, then saves and records it', async () => {
    const { service, tx, audit } = setup();

    await service.update(ID, { brandId: BRAND }, context);

    expect(rawCall(tx.$queryRaw, 0).sql).toMatch(
      /FROM products WHERE id = \?::uuid FOR UPDATE/,
    );
    const { sql, values } = rawCall(tx.$queryRaw, 1);
    expect(sql).toMatch(brandCheck);
    expect(values).toEqual([BRAND]);
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { brandId: BRAND } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        before: { brandId: null },
        after: { brandId: BRAND },
      }),
    );
  });

  it('refuses a change to a brand that does not exist, and saves nothing', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ id: ID }]).mockResolvedValueOnce([]);

    await expect(
      refusal(service.update(ID, { brandId: BRAND }, context)),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [{ field: 'brandId', message: 'No brand with this ID' }],
    });
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('takes the brand away with null, asking nothing about brands', async () => {
    const { service, tx, audit } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(storedRow({ brandId: BRAND }));

    await service.update(ID, { brandId: null }, context);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { brandId: null } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        before: { brandId: BRAND },
        after: { brandId: null },
      }),
    );
  });
});

describe('ProductsService.listOrder', () => {
  it('lists every product shown in the category, drafts too, in the order customers see them', async () => {
    const { service, prisma } = setup([storedRow()]);
    prisma.$queryRaw.mockResolvedValue([{ id: ID }]);

    await expect(service.listOrder({ categoryId: CATEGORY })).resolves.toEqual(
      { products: [stored()] },
    );

    expect(prisma.category.findUnique).toHaveBeenCalledWith({
      where: { id: CATEGORY },
      select: { id: true },
    });
    const { sql, values } = rawCall(prisma.$queryRaw);
    // Its own products, and those also shown in it, each at its place.
    expect(sql).toMatch(/WHERE p\."categoryId" = \?::uuid\s+UNION ALL/);
    expect(sql).toContain('SELECT p."id", p."name", o."position"');
    expect(sql).toContain('WHERE o."categoryId" = ?::uuid');
    expect(sql).toContain('ORDER BY "position", "name", "id"');
    // Drafts too.
    expect(sql).not.toContain('isActive');
    expect(values).toEqual([CATEGORY, CATEGORY]);
  });

  it('answers 400 on categoryId for a category that does not exist', async () => {
    const { service, prisma } = setup();
    prisma.category.findUnique.mockResolvedValue(null);

    await expect(
      refusal(service.listOrder({ categoryId: CATEGORY })),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [{ field: 'categoryId', message: 'No category with this ID' }],
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

// Part 15A: a product keeps one main category and may also be shown in
// others.
describe('ProductsService other categories', () => {
  const OTHER_A = '1d4f7a2c-8b3e-4c6d-9e0f-2a5b8c1d4e7f';
  const OTHER_B = '6e9b2c5f-1a4d-4e7b-8c0f-3d6a9b2c5e8f';
  const placesCheck =
    /FROM "categories" c\s+WHERE c\."id" = ANY\(\?::uuid\[\]\)\s+ORDER BY c\."id"\s+FOR KEY SHARE OF c/;
  const others = (...ids: string[]) => ids.map((categoryId) => ({ categoryId }));
  const refused = (message: string) => ({
    message: 'Validation failed',
    errors: [{ field: 'otherCategoryIds', message }],
  });
  const draft = {
    categoryId: CATEGORY,
    name: 'Tulsi Tea',
    slug: 'tulsi-tea',
    position: 0,
  };

  it('saves a new product shown in other categories that exist, each going last there, and records them', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw.mockResolvedValue([
      { id: OTHER_A, position: 4 },
      { id: OTHER_B, position: 0 },
    ]);
    tx.product.create.mockResolvedValue(
      storedRow({ otherCategories: others(OTHER_A, OTHER_B) }),
    );

    await expect(
      service.create({ ...draft, otherCategoryIds: [OTHER_B, OTHER_A] }, context),
    ).resolves.toEqual(stored({ otherCategoryIds: [OTHER_A, OTHER_B] }));

    const { sql, values } = rawCall(tx.$queryRaw);
    expect(sql).toMatch(placesCheck);
    // Last among the category's own products and those also shown there.
    expect(sql).toContain('(SELECT MAX(p."position") FROM "products" p');
    expect(sql).toContain('(SELECT MAX(o."position") FROM "product_categories" o');
    expect(values).toEqual([[OTHER_B, OTHER_A]]);
    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          ...draft,
          otherCategories: {
            create: [
              { categoryId: OTHER_A, position: 4 },
              { categoryId: OTHER_B, position: 0 },
            ],
          },
        },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        after: expect.objectContaining({
          otherCategoryIds: [OTHER_A, OTHER_B],
        }) as object,
      }),
    );
  });

  it('puts a new product last in its main category and in each other one, locking them all in one go', async () => {
    const { service, tx } = setup();
    // In the order of their IDs.
    tx.$queryRaw.mockResolvedValue([
      { id: OTHER_A, position: 1 },
      { id: CATEGORY, position: 3 },
    ]);
    const { position: _given, ...unplaced } = draft;

    await service.create({ ...unplaced, otherCategoryIds: [OTHER_A] }, context);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const { sql, values } = rawCall(tx.$queryRaw);
    expect(sql).toMatch(placesCheck);
    expect(values).toEqual([[CATEGORY, OTHER_A]]);
    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          ...unplaced,
          position: 3,
          otherCategories: { create: [{ categoryId: OTHER_A, position: 1 }] },
        },
      }),
    );
  });

  it('asks nothing about other categories for a new product shown in its main one only', async () => {
    const { service, tx } = setup();

    await service.create({ ...draft, otherCategoryIds: [] }, context);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([
    [
      'its main category',
      [CATEGORY],
      [],
      'Its main category cannot be one of its other categories too',
    ],
    [
      'a category that does not exist',
      [OTHER_A, OTHER_B],
      [{ id: OTHER_A, position: 0 }],
      'No category with one of these IDs',
    ],
  ])(
    'refuses a new product shown in %s, and saves nothing',
    async (_case, otherCategoryIds, rows, message) => {
      const { service, tx, audit } = setup();
      tx.$queryRaw.mockResolvedValue(rows);

      await expect(
        refusal(service.create({ ...draft, otherCategoryIds }, context)),
      ).resolves.toEqual(refused(message));
      expect(tx.product.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('replaces the list once the product is locked: takes off those left out, adds the new ones last, and records both lists', async () => {
    const { service, tx, audit, logger } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(
      storedRow({ otherCategories: others(OTHER_A) }),
    );
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: ID }])
      .mockResolvedValueOnce([{ id: OTHER_B, position: 7 }]);
    tx.product.update.mockResolvedValue(
      storedRow({ otherCategories: others(OTHER_B) }),
    );

    await expect(
      service.update(ID, { otherCategoryIds: [OTHER_B] }, context),
    ).resolves.toEqual(stored({ otherCategoryIds: [OTHER_B] }));

    const { sql, values } = rawCall(tx.$queryRaw, 1);
    expect(sql).toMatch(placesCheck);
    // Only the one added.
    expect(values).toEqual([[OTHER_B]]);
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ID },
        data: {
          otherCategories: {
            deleteMany: { categoryId: { notIn: [OTHER_B] } },
            create: [{ categoryId: OTHER_B, position: 7 }],
          },
        },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'product.updated',
      targetType: 'product',
      targetId: ID,
      before: { otherCategoryIds: [OTHER_A] },
      after: { otherCategoryIds: [OTHER_B] },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { productId: ID, actorId: context.actorId },
      'Product changed',
    );
  });

  it('keeps the ones kept where they are, and records the new list in the order the database gives it back', async () => {
    const { service, tx, audit } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(
      storedRow({ otherCategories: others(OTHER_B) }),
    );
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: ID }])
      .mockResolvedValueOnce([{ id: OTHER_A, position: 2 }]);

    await service.update(ID, { otherCategoryIds: [OTHER_B, OTHER_A] }, context);

    expect(rawCall(tx.$queryRaw, 1).values).toEqual([[OTHER_A]]);
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          otherCategories: {
            deleteMany: { categoryId: { notIn: [OTHER_A, OTHER_B] } },
            create: [{ categoryId: OTHER_A, position: 2 }],
          },
        },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        before: { otherCategoryIds: [OTHER_B] },
        after: { otherCategoryIds: [OTHER_A, OTHER_B] },
      }),
    );
  });

  it('takes it off every other category with an empty list, asking nothing about categories', async () => {
    const { service, tx, audit } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(
      storedRow({ otherCategories: others(OTHER_A) }),
    );

    await service.update(ID, { otherCategoryIds: [] }, context);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          otherCategories: {
            deleteMany: { categoryId: { notIn: [] } },
            create: [],
          },
        },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        before: { otherCategoryIds: [OTHER_A] },
        after: { otherCategoryIds: [] },
      }),
    );
  });

  it('changes and records nothing for the same list in another order', async () => {
    const { service, tx, audit } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(
      storedRow({ otherCategories: others(OTHER_A, OTHER_B) }),
    );

    await expect(
      service.update(ID, { otherCategoryIds: [OTHER_B, OTHER_A] }, context),
    ).resolves.toEqual(stored({ otherCategoryIds: [OTHER_A, OTHER_B] }));

    expect(tx.product.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('leaves the list alone when a change does not send it', async () => {
    const { service, tx } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(
      storedRow({ otherCategories: others(OTHER_A) }),
    );

    await service.update(ID, { name: 'Renamed' }, context);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Renamed' } }),
    );
  });

  it.each([
    [
      'shown in its main category',
      { otherCategoryIds: [CATEGORY] },
      [],
      [],
      'Its main category cannot be one of its other categories too',
    ],
    [
      'moved to a main category it is also shown in',
      { categoryId: OTHER_A },
      [OTHER_A],
      [],
      'Its main category cannot be one of its other categories too',
    ],
    [
      'shown in a category that does not exist',
      { otherCategoryIds: [OTHER_B] },
      [],
      [],
      'No category with one of these IDs',
    ],
  ])(
    'refuses a product %s, and changes nothing',
    async (_case, change, current, found, message) => {
      const { service, tx, audit } = setup();
      tx.product.findUniqueOrThrow.mockResolvedValue(
        storedRow({ otherCategories: others(...current) }),
      );
      tx.$queryRaw
        .mockResolvedValueOnce([{ id: ID }])
        .mockResolvedValueOnce(found);

      await expect(
        refusal(service.update(ID, change, context)),
      ).resolves.toEqual(refused(message));
      expect(tx.product.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('moves its main category to one it was also shown in, when the same change takes that one off the list', async () => {
    const { service, tx } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(
      storedRow({ otherCategories: others(OTHER_A) }),
    );
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: ID }])
      .mockResolvedValueOnce([{ id: OTHER_A, position: 5 }]);

    await service.update(
      ID,
      { categoryId: OTHER_A, otherCategoryIds: [] },
      context,
    );

    expect(rawCall(tx.$queryRaw, 1).values).toEqual([[OTHER_A]]);
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          categoryId: OTHER_A,
          position: 5,
          otherCategories: {
            deleteMany: { categoryId: { notIn: [] } },
            create: [],
          },
        },
      }),
    );
  });

  it('puts a product moved into another category last there, and records its new place', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: ID }])
      .mockResolvedValueOnce([{ id: OTHER_B, position: 6 }]);

    await service.update(ID, { categoryId: OTHER_B }, context);

    const { sql, values } = rawCall(tx.$queryRaw, 1);
    expect(sql).toMatch(placesCheck);
    expect(values).toEqual([[OTHER_B]]);
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { categoryId: OTHER_B, position: 6 },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        before: { categoryId: CATEGORY, position: 0 },
        after: { categoryId: OTHER_B, position: 6 },
      }),
    );
  });

  it('keeps its place when the last place in the new category is the one it has', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: ID }])
      .mockResolvedValueOnce([{ id: OTHER_B, position: 0 }]);

    await service.update(ID, { categoryId: OTHER_B }, context);

    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { categoryId: OTHER_B } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        before: { categoryId: CATEGORY },
        after: { categoryId: OTHER_B },
      }),
    );
  });

  it('keeps the place given with a move, and asks nothing about places without one', async () => {
    const { service, tx } = setup();

    await service.update(ID, { categoryId: OTHER_B, position: 2 }, context);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { categoryId: OTHER_B, position: 2 } }),
    );

    await service.update(ID, { name: 'Renamed' }, context);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('answers 400 on categoryId when the category it moves to does not exist', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw.mockResolvedValueOnce([{ id: ID }]).mockResolvedValueOnce([]);

    await expect(
      refusal(service.update(ID, { categoryId: OTHER_B }, context)),
    ).resolves.toEqual({
      message: 'Validation failed',
      errors: [{ field: 'categoryId', message: 'No category with this ID' }],
    });
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
