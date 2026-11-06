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
function stored(changes: object = {}) {
  return { id: ID, ...draftFields, createdAt, updatedAt: createdAt, ...changes };
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
      create: jest.fn().mockResolvedValue(stored()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(stored()),
      update: jest.fn().mockResolvedValue(stored({ name: 'Renamed' })),
      delete: jest.fn().mockResolvedValue({ id: ID }),
    },
    productVariant: { findMany: jest.fn().mockResolvedValue([]) },
    productImage: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const prisma = {
    product: {
      findMany: jest.fn().mockResolvedValue(products),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    category: { findFirst: jest.fn().mockResolvedValue(shopCategory) },
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
    const { service, prisma } = setup([stored()]);

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
        select: Record<string, boolean>;
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
      ['id', ...Object.keys(draftFields), 'createdAt', 'updatedAt'].sort(),
    );
  });

  it('filters, continues after a product, and says where the next page starts', async () => {
    const second = stored({ id: 'b' });
    const { service, prisma } = setup([stored({ id: 'a' }), second, stored({ id: 'c' })]);

    await expect(
      service.list({ limit: 2, after: ID, categoryId: CATEGORY, isActive: true }),
    ).resolves.toEqual({
      products: [stored({ id: 'a' }), second],
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
  it('saves the product and records everything staff set, in the same transaction', async () => {
    const { service, tx, audit, logger } = setup();
    const input = { categoryId: CATEGORY, name: 'Ashwagandha Capsules', slug: 'ashwagandha-capsules' };

    await expect(service.create(input, context)).resolves.toEqual(stored());

    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: input }),
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'product.created',
      targetType: 'product',
      targetId: ID,
      after: draftFields,
    });
    expect(logger.info).toHaveBeenCalledWith(
      { productId: ID, actorId: context.actorId },
      'Product created',
    );
  });

  it('answers 409 when another product has the slug', async () => {
    const { service, tx, audit } = setup();
    tx.product.create.mockRejectedValue(withCode('P2002'));

    await expect(
      service.create({ categoryId: CATEGORY, name: 'Tulsi Tea', slug: 'tulsi-tea' }, context),
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
        service.create({ categoryId: CATEGORY, name: 'Tulsi Tea', slug: 'tulsi-tea' }, context),
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
      service.create({ categoryId: CATEGORY, name: 'Tulsi Tea', slug: 'tulsi-tea' }, context),
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
      stored({ ...details, ingredients: null, manufacturerAddress: null }),
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
    tx.product.findUniqueOrThrow.mockResolvedValue(stored(details));

    await service.update(ID, { isActive: true }, context);
    expect(tx.product.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { isActive: true } }),
    );

    tx.product.findUniqueOrThrow.mockResolvedValue(stored());
    await service.update(ID, { ...details, isActive: true }, context);
    expect(tx.product.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { ...details, isActive: true } }),
    );
  });

  it('refuses to activate a product without an image, counted while it is locked', async () => {
    const { service, tx, audit } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(stored(details));
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
    tx.product.findUniqueOrThrow.mockResolvedValue(stored({ ...details, isActive: true }));

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
    tx.product.findUniqueOrThrow.mockResolvedValue(stored(details));

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
        service.update(ID, { categoryId: '00000000-0000-4000-8000-000000000000' }, context),
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
    tx.product.findUniqueOrThrow.mockResolvedValue(stored({ ...details, isActive: true }));
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
      before: { ...draftFields, ...details, isActive: true, variants: packs, images },
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
    name: slug,
    slug,
    summary: null,
    variants: priceRupees ? [{ priceRupees }] : [],
    images: [{ fileKey: KEY }],
  });
  // The same product as a customer sees its card.
  const card = (slug: string, fromPriceRupees: number | null = null) => ({
    name: slug,
    slug,
    summary: null,
    fromPriceRupees,
    imageUrl: `${BASE}/products/${KEY}-small.webp`,
  });

  it("shows an active category and one page of its active products: a card's fields and the lowest price", async () => {
    const { service, prisma } = setup([row('a', 450), row('b')]);

    await expect(service.listForShop('herbal-supplements', { limit: 20 })).resolves.toEqual({
      category: shopCategory,
      products: [card('a', 450), card('b')],
      nextAfter: null,
    });
    expect(prisma.category.findFirst).toHaveBeenCalledWith({
      where: { slug: 'herbal-supplements', isActive: true },
      select: { name: true, slug: true, description: true },
    });
    expect(prisma.product.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        category: { slug: 'herbal-supplements', isActive: true },
      },
      orderBy: [{ position: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take: 21,
      select: {
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
    const { service } = setup([{ ...row('a'), images: [] }]);

    await expect(
      service.listForShop('herbal-supplements', { limit: 20 }),
    ).resolves.toMatchObject({ products: [{ ...card('a'), imageUrl: null }] });
  });

  it('continues after the slug of the last product shown', async () => {
    const { service, prisma } = setup([row('b'), row('c'), row('d')]);

    await expect(
      service.listForShop('herbal-supplements', { limit: 2, after: 'a' }),
    ).resolves.toMatchObject({ products: [card('b'), card('c')], nextAfter: 'c' });
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, cursor: { slug: 'a' }, skip: 1 }),
    );
  });

  it('answers 404 for a hidden or unknown category, and looks for no products', async () => {
    const { service, prisma } = setup();
    prisma.category.findFirst.mockResolvedValue(null);

    await expect(
      service.listForShop('hidden-category', { limit: 20 }),
    ).rejects.toThrow(new NotFoundException('Category not found'));
    expect(prisma.product.findMany).not.toHaveBeenCalled();
  });
});

describe('ProductsService.findForShop', () => {
  it("shows an active product of an active category, with its licence and maker details", async () => {
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
      category: { isActive: true },
    });
    expect(Object.keys(query.select).sort()).toEqual([
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
    expect(query.select.category).toEqual({ select: { name: true, slug: true } });
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
