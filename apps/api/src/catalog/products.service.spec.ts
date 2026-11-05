import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from './products.service';

const ID = '3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e';
const CATEGORY = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
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
  const logger = { info: jest.fn() };
  const service = new ProductsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, audit, logger };
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
  it('locks the product, deletes it, and records what it was, pack sizes included, in the same transaction', async () => {
    const { service, tx, audit, logger } = setup();
    tx.product.findUniqueOrThrow.mockResolvedValue(stored({ ...details, isActive: true }));
    const packs = [
      { sku: 'ASH-CAP-60', quantity: 60, unit: 'CAPSULES', mrpRupees: 500, priceRupees: 450, isActive: true },
    ];
    tx.productVariant.findMany.mockResolvedValue(packs);

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
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'product.deleted',
      targetType: 'product',
      targetId: ID,
      before: { ...draftFields, ...details, isActive: true, variants: packs },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { productId: ID, actorId: context.actorId },
      'Product deleted',
    );
  });

  it('answers 404 for an unknown ID, and deletes nothing', async () => {
    const { service, tx, audit, logger } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(service.remove(ID, context)).rejects.toThrow(
      new NotFoundException('Product not found'),
    );
    expect(tx.product.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('ProductsService.listForShop', () => {
  // A product as the query returns it, with its cheapest pack on sale, if any.
  const row = (slug: string, priceRupees?: number) => ({
    name: slug,
    slug,
    summary: null,
    variants: priceRupees ? [{ priceRupees }] : [],
  });
  // The same product as a customer sees its card.
  const card = (slug: string, fromPriceRupees: number | null = null) => ({
    name: slug,
    slug,
    summary: null,
    fromPriceRupees,
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
      },
    });
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
    const page = { name: 'Ashwagandha Capsules', slug: 'ashwagandha-capsules' };
    prisma.product.findFirst.mockResolvedValue(page);

    await expect(service.findForShop('ashwagandha-capsules')).resolves.toBe(page);

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
    // Only the packs on sale, each by its SKU: no IDs in the shop.
    expect(query.select.variants).toEqual({
      where: { isActive: true },
      orderBy: [{ position: 'asc' }, { quantity: 'asc' }, { id: 'asc' }],
      select: {
        sku: true,
        quantity: true,
        unit: true,
        mrpRupees: true,
        priceRupees: true,
      },
    });
  });

  it('answers 404 for a hidden or unknown product', async () => {
    const { service } = setup();

    await expect(service.findForShop('draft-product')).rejects.toThrow(
      new NotFoundException('Product not found'),
    );
  });
});
