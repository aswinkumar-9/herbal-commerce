import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from './categories.service';

const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
// A top category, and another category (part 15A).
const TOP = '2b7e4f1a-6c3d-4e8f-9a0b-5d1c7e3f9a26';
const OTHER = '4e8a1c5f-2d6b-4f9e-8c3a-7b0d2e6f1a94';
const ORDER = [{ position: 'asc' }, { name: 'asc' }, { id: 'asc' }];
// The lock on the categories changed, and on the one moved into, if any.
const LOCKED =
  /FROM categories\s+WHERE id = ANY\(\?::uuid\[\]\) ORDER BY id FOR UPDATE/;
const createdAt = new Date('2026-11-02T09:15:00.000Z');
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};

// A category as the query returns it.
function stored(changes: object = {}) {
  return {
    id: ID,
    name: 'Hair Care',
    slug: 'hair-care',
    description: null,
    isActive: false,
    position: 0,
    parentId: null,
    createdAt,
    updatedAt: createdAt,
    ...changes,
  };
}

// The error Prisma gives when the unique index refuses a slug.
const slugClash = Object.assign(new Error('Unique constraint failed'), {
  code: 'P2002',
});

// The answer of a refused change: 400, with the field and why.
async function refusal(promise: Promise<unknown>) {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BadRequestException);
  return (error as BadRequestException).getResponse();
}

const refused = (message: string) => ({
  message: 'Validation failed',
  errors: [{ field: 'parentId', message }],
});

function setup(categories: object[] = []) {
  const tx = {
    // The locked rows: where each sits.
    $queryRaw: jest.fn().mockResolvedValue([{ id: ID, parentId: null }]),
    category: {
      create: jest.fn().mockResolvedValue(stored()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(stored()),
      // No subcategories, and the top category exists.
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ id: TOP }),
      update: jest.fn().mockResolvedValue(stored({ isActive: true })),
      delete: jest.fn().mockResolvedValue({ id: ID }),
    },
    // No product from another category is shown in it.
    productCategory: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const prisma = {
    category: { findMany: jest.fn().mockResolvedValue(categories) },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const logger = { info: jest.fn() };
  const service = new CategoriesService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, audit, logger };
}

describe('CategoriesService.list', () => {
  it('lists every category, hidden ones too, in the order customers see them', async () => {
    const { service, prisma } = setup([stored()]);

    await expect(service.list()).resolves.toEqual({
      categories: [stored()],
    });

    const [query] = prisma.category.findMany.mock.calls[0] as [
      { where?: object; orderBy: object; select: Record<string, boolean> },
    ];
    expect(query.where).toBeUndefined();
    expect(query.orderBy).toEqual([
      { position: 'asc' },
      { name: 'asc' },
      { id: 'asc' },
    ]);
    expect(Object.keys(query.select).sort()).toEqual([
      'createdAt',
      'description',
      'id',
      'isActive',
      'name',
      'parentId',
      'position',
      'slug',
      'updatedAt',
    ]);
  });

  it('puts each top category first, then its subcategories, each level in its own order (part 15A)', async () => {
    // As the query returns them: by position, then by name.
    const { service } = setup([
      stored({ id: 'sub-b1', parentId: 'top-b', position: 0 }),
      stored({ id: 'top-a', position: 0 }),
      stored({ id: 'sub-a1', parentId: 'top-a', position: 0 }),
      stored({ id: 'sub-a2', parentId: 'top-a', position: 1 }),
      stored({ id: 'top-b', position: 1 }),
    ]);

    const { categories } = await service.list();
    expect(categories.map(({ id }) => id)).toEqual([
      'top-a',
      'sub-a1',
      'sub-a2',
      'top-b',
      'sub-b1',
    ]);
  });
});

describe('CategoriesService.listActive', () => {
  it('lists the active top categories, each with its active subcategories, in the same order, with only what a shop page needs', async () => {
    const shown = {
      name: 'Hair Care',
      slug: 'hair-care',
      description: null,
      subcategories: [
        { name: 'Hair Oils', slug: 'hair-oils', description: null },
      ],
    };
    const { service, prisma } = setup([shown]);

    await expect(service.listActive()).resolves.toEqual({
      categories: [shown],
    });

    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { isActive: true, parentId: null },
      orderBy: ORDER,
      select: {
        name: true,
        slug: true,
        description: true,
        subcategories: {
          where: { isActive: true },
          orderBy: ORDER,
          select: { name: true, slug: true, description: true },
        },
      },
    });
  });
});

describe('CategoriesService.create', () => {
  it('saves the category and records who created it, in the same transaction', async () => {
    const { service, tx, audit, logger } = setup();
    const input = { name: 'Hair Care', slug: 'hair-care' };

    await expect(service.create(input, context)).resolves.toEqual(stored());

    expect(tx.category.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: input }),
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'category.created',
      targetType: 'category',
      targetId: ID,
      after: {
        name: 'Hair Care',
        slug: 'hair-care',
        description: null,
        isActive: false,
        position: 0,
        parentId: null,
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { categoryId: ID, actorId: context.actorId },
      'Category created',
    );
  });

  it('locks nothing for a top category', async () => {
    const { service, tx } = setup();

    await service.create(
      { name: 'Hair Care', slug: 'hair-care', parentId: null },
      context,
    );
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('answers 409 when another category has the slug', async () => {
    const { service, tx, audit, logger } = setup();
    tx.category.create.mockRejectedValue(slugClash);

    await expect(
      service.create({ name: 'Hair Care', slug: 'hair-care' }, context),
    ).rejects.toThrow(
      new ConflictException(
        'Another category already has this slug. Choose a different one.',
      ),
    );
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('passes on any other error unchanged', async () => {
    const { service, tx } = setup();
    const broken = new Error('connection lost');
    tx.category.create.mockRejectedValue(broken);

    await expect(
      service.create({ name: 'Hair Care', slug: 'hair-care' }, context),
    ).rejects.toBe(broken);
  });
});

describe('CategoriesService.update', () => {
  it('locks the category first, so the audit entry shows exactly what changed', async () => {
    const { service, tx } = setup();

    await service.update(ID, { isActive: true }, context);

    const [sql, ids] = tx.$queryRaw.mock.calls[0] as [string[], string[]];
    expect(sql.join('?')).toMatch(LOCKED);
    // A parameter, never pasted into the SQL.
    expect(ids).toEqual([ID]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.category.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
  });

  it('saves only the fields that change, and records them before and after', async () => {
    const { service, tx, audit, logger } = setup();
    tx.category.findUniqueOrThrow.mockResolvedValue(
      stored({ description: 'Oils' }),
    );

    await expect(
      service.update(
        ID,
        { name: 'Hair Care', isActive: true, description: null },
        context,
      ),
    ).resolves.toEqual(stored({ isActive: true }));

    expect(tx.category.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ID },
        data: { isActive: true, description: null },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'category.updated',
      targetType: 'category',
      targetId: ID,
      before: { isActive: false, description: 'Oils' },
      after: { isActive: true, description: null },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { categoryId: ID, actorId: context.actorId },
      'Category changed',
    );
  });

  it('changes and records nothing when every value is already the same', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(
      service.update(ID, { name: 'Hair Care', isActive: false }, context),
    ).resolves.toEqual(stored());

    expect(tx.category.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown ID, and changes nothing', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      service.update(ID, { isActive: true }, context),
    ).rejects.toThrow(new NotFoundException('Category not found'));
    expect(tx.category.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('answers 409 when the new slug belongs to another category', async () => {
    const { service, tx, audit } = setup();
    tx.category.update.mockRejectedValue(slugClash);

    await expect(
      service.update(ID, { slug: 'skin-care' }, context),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('CategoriesService.remove', () => {
  it('locks the category, deletes it, and records what it was in the same transaction', async () => {
    const { service, tx, audit, logger } = setup();
    tx.category.findUniqueOrThrow.mockResolvedValue(
      stored({ description: 'Oils', isActive: true, position: 3 }),
    );

    await expect(service.remove(ID, context)).resolves.toBeUndefined();

    const [sql, ids] = tx.$queryRaw.mock.calls[0] as [string[], string[]];
    expect(sql.join('?')).toMatch(LOCKED);
    expect(ids).toEqual([ID]);
    expect(tx.category.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID } }),
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.category.delete.mock.invocationCallOrder[0],
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'category.deleted',
      targetType: 'category',
      targetId: ID,
      before: {
        name: 'Hair Care',
        slug: 'hair-care',
        description: 'Oils',
        isActive: true,
        position: 3,
        parentId: null,
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { categoryId: ID, actorId: context.actorId },
      'Category deleted',
    );
  });

  it('answers 404 for an unknown ID, and deletes nothing', async () => {
    const { service, tx, audit, logger } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(service.remove(ID, context)).rejects.toThrow(
      new NotFoundException('Category not found'),
    );
    expect(tx.category.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('CategoriesService.remove, with subcategories', () => {
  it('answers 409 while the category has subcategories, looked for once it is locked, and deletes nothing', async () => {
    const { service, tx, audit, logger } = setup();
    tx.category.findFirst.mockResolvedValue({ id: OTHER });

    await expect(service.remove(ID, context)).rejects.toThrow(
      new ConflictException(
        'This category still has subcategories. Move them to another category or delete them first.',
      ),
    );
    expect(tx.category.findFirst).toHaveBeenCalledWith({
      where: { parentId: ID },
      select: { id: true },
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.category.findFirst.mock.invocationCallOrder[0],
    );
    expect(tx.category.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('CategoriesService.remove, showing products from other categories (part 15A)', () => {
  it('answers 409 while it still shows a product whose main category is another, and deletes nothing', async () => {
    const { service, tx, audit, logger } = setup();
    tx.productCategory.findFirst.mockResolvedValue({ productId: OTHER });

    await expect(service.remove(ID, context)).rejects.toThrow(
      new ConflictException(
        'This category still shows products from other categories. Take it off their other categories first.',
      ),
    );
    expect(tx.productCategory.findFirst).toHaveBeenCalledWith({
      where: { categoryId: ID },
      select: { productId: true },
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.productCategory.findFirst.mock.invocationCallOrder[0],
    );
    expect(tx.category.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('CategoriesService.remove, with products', () => {
  it('answers 409 while the category still has products, and records nothing', async () => {
    const { service, tx, audit, logger } = setup();
    tx.category.delete.mockRejectedValue(
      Object.assign(new Error('Foreign key constraint violated'), {
        code: 'P2003',
      }),
    );

    await expect(service.remove(ID, context)).rejects.toThrow(
      new ConflictException(
        'This category still has products. Move them to another category or delete them first.',
      ),
    );
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('passes on any other error unchanged', async () => {
    const { service, tx } = setup();
    const broken = new Error('connection lost');
    tx.category.delete.mockRejectedValue(broken);

    await expect(service.remove(ID, context)).rejects.toBe(broken);
  });
});

describe('CategoriesService.reorder', () => {
  const SECOND = '8d0f7780-8536-41ef-a55c-f18c2b01bf18';
  const THIRD = '9e1a8891-9647-42f0-b66d-0a9d3c12c029';

  function reorderSetup(positions: Record<string, number>) {
    const ready = setup([stored()]);
    ready.tx.$queryRaw.mockResolvedValueOnce(
      Object.entries(positions).map(([id, position]) => ({ id, position })),
    );
    return ready;
  }

  it('gives each category its place in the list, and records each one that moved', async () => {
    const { service, tx, audit, logger } = reorderSetup({
      [ID]: 0,
      [SECOND]: 5,
      [THIRD]: 2,
    });

    await expect(
      service.reorder({ parentId: null, ids: [SECOND, ID, THIRD] }, context),
    ).resolves.toEqual({ categories: [stored()] });

    expect(tx.category.update.mock.calls).toEqual([
      [{ where: { id: SECOND }, data: { position: 0 }, select: { id: true } }],
      [{ where: { id: ID }, data: { position: 1 }, select: { id: true } }],
    ]);
    expect(audit.record.mock.calls.map(([, entry]) => entry)).toEqual([
      {
        ...context,
        action: 'category.updated',
        targetType: 'category',
        targetId: SECOND,
        before: { position: 5 },
        after: { position: 0 },
      },
      {
        ...context,
        action: 'category.updated',
        targetType: 'category',
        targetId: ID,
        before: { position: 0 },
        after: { position: 1 },
      },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      { parentId: null, moved: 2, actorId: context.actorId },
      'Categories reordered',
    );
  });

  it('locks every top category in the order of their IDs, letting products be saved meanwhile', async () => {
    const { service, tx } = reorderSetup({ [ID]: 0 });

    await service.reorder({ parentId: null, ids: [ID] }, context);

    const [strings, parentId] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string | null,
    ];
    expect(strings.join('?')).toMatch(
      /WHERE "parentId" IS NOT DISTINCT FROM \?::uuid\s+ORDER BY id FOR NO KEY UPDATE/,
    );
    expect(parentId).toBeNull();
    expect(tx.category.findUnique).not.toHaveBeenCalled();
  });

  it('orders the subcategories of one top category, which must exist (part 15A)', async () => {
    const { service, tx, logger } = reorderSetup({ [ID]: 1 });

    await service.reorder({ parentId: TOP, ids: [ID] }, context);

    expect(tx.category.findUnique).toHaveBeenCalledWith({
      where: { id: TOP },
      select: { id: true },
    });
    const [, parentId] = tx.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string | null,
    ];
    expect(parentId).toBe(TOP);
    expect(tx.category.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { position: 0 },
      select: { id: true },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { parentId: TOP, moved: 1, actorId: context.actorId },
      'Categories reordered',
    );
  });

  it('answers 400 for an unknown top category, and changes nothing', async () => {
    const { service, tx, audit } = reorderSetup({ [ID]: 0 });
    tx.category.findUnique.mockResolvedValue(null);

    await expect(
      refusal(service.reorder({ parentId: TOP, ids: [ID] }, context)),
    ).resolves.toEqual(refused('No category with this ID'));
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.category.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('changes and records nothing when the order is the same', async () => {
    const { service, tx, audit } = reorderSetup({ [ID]: 0, [SECOND]: 1 });

    await service.reorder({ parentId: null, ids: [ID, SECOND] }, context);

    expect(tx.category.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ['a category is missing', [ID]],
    ['a category is unknown', [ID, THIRD]],
    ['the list is longer', [ID, SECOND, THIRD]],
  ])('answers 409 and changes nothing when %s', async (_case, ids) => {
    const { service, tx, audit } = reorderSetup({ [ID]: 0, [SECOND]: 1 });

    await expect(
      service.reorder({ parentId: null, ids }, context),
    ).rejects.toThrow(
      new ConflictException(
        'The categories changed while you were ordering them. Reload and try again.',
      ),
    );
    expect(tx.category.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('CategoriesService.create, inside a top category (part 15A)', () => {
  const input = { name: 'Hair Oils', slug: 'hair-oils', parentId: TOP };

  it('locks the top category first, so it stays one, then saves the subcategory and records where it sits', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw.mockResolvedValue([{ id: TOP, parentId: null }]);
    tx.category.create.mockResolvedValue(stored({ parentId: TOP }));

    await expect(service.create(input, context)).resolves.toEqual(
      stored({ parentId: TOP }),
    );

    const [sql, ids] = tx.$queryRaw.mock.calls[0] as [string[], string[]];
    expect(sql.join('?')).toMatch(LOCKED);
    expect(ids).toEqual([TOP]);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.category.create.mock.invocationCallOrder[0],
    );
    expect(tx.category.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: input }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        after: expect.objectContaining({ parentId: TOP }),
      }),
    );
  });

  it.each([
    ['an unknown category', [], 'No category with this ID'],
    [
      'a subcategory',
      [{ id: TOP, parentId: OTHER }],
      'This is a subcategory. Choose a top category: there are only two levels.',
    ],
  ])(
    'answers 400 inside %s, and saves nothing',
    async (_case, rows, message) => {
      const { service, tx, audit } = setup();
      tx.$queryRaw.mockResolvedValue(rows);

      await expect(refusal(service.create(input, context))).resolves.toEqual(
        refused(message),
      );
      expect(tx.category.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );
});

describe('CategoriesService.update, moving it (part 15A)', () => {
  // The rows the lock reads, and the category as it is now.
  function moveSetup(rows: object[], changes: object = {}) {
    const ready = setup();
    ready.tx.$queryRaw.mockResolvedValue(rows);
    ready.tx.category.findUniqueOrThrow.mockResolvedValue(stored(changes));
    ready.tx.category.update.mockResolvedValue(stored({ parentId: TOP }));
    return ready;
  }
  const both = [
    { id: ID, parentId: null },
    { id: TOP, parentId: null },
  ];

  it('locks it and the top category in one go, in the order of their IDs, then moves it and records the move', async () => {
    const { service, tx, audit, logger } = moveSetup(both);

    await expect(
      service.update(ID, { parentId: TOP }, context),
    ).resolves.toEqual(stored({ parentId: TOP }));

    const [sql, ids] = tx.$queryRaw.mock.calls[0] as [string[], string[]];
    expect(sql.join('?')).toMatch(LOCKED);
    expect(ids).toEqual([ID, TOP]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    // It has no subcategories of its own.
    expect(tx.category.findFirst).toHaveBeenCalledWith({
      where: { parentId: ID },
      select: { id: true },
    });
    expect(tx.category.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID }, data: { parentId: TOP } }),
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'category.updated',
      targetType: 'category',
      targetId: ID,
      before: { parentId: null },
      after: { parentId: TOP },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { categoryId: ID, actorId: context.actorId },
      'Category changed',
    );
  });

  it('makes it a top category again with null, with nothing else to check', async () => {
    const { service, tx, audit } = moveSetup([{ id: ID, parentId: TOP }], {
      parentId: TOP,
    });
    tx.category.update.mockResolvedValue(stored());

    await service.update(ID, { parentId: null }, context);

    const [, ids] = tx.$queryRaw.mock.calls[0] as [string[], string[]];
    expect(ids).toEqual([ID]);
    expect(tx.category.findFirst).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        before: { parentId: TOP },
        after: { parentId: null },
      }),
    );
  });

  it('checks and changes nothing when it already sits there', async () => {
    const { service, tx, audit } = moveSetup(both, { parentId: TOP });

    await service.update(ID, { parentId: TOP }, context);

    expect(tx.category.findFirst).not.toHaveBeenCalled();
    expect(tx.category.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    [
      'into itself',
      ID,
      [{ id: ID, parentId: null }],
      'A category cannot sit inside itself',
    ],
    [
      'into an unknown category',
      TOP,
      [{ id: ID, parentId: null }],
      'No category with this ID',
    ],
    [
      'into a subcategory',
      TOP,
      [
        { id: ID, parentId: null },
        { id: TOP, parentId: OTHER },
      ],
      'This is a subcategory. Choose a top category: there are only two levels.',
    ],
  ])(
    'answers 400 for a move %s, and changes nothing',
    async (_case, parentId, rows, message) => {
      const { service, tx, audit } = moveSetup(rows);

      await expect(
        refusal(service.update(ID, { parentId }, context)),
      ).resolves.toEqual(refused(message));
      expect(tx.category.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('answers 400 while it has subcategories of its own, and changes nothing', async () => {
    const { service, tx, audit } = moveSetup(both);
    tx.category.findFirst.mockResolvedValue({ id: OTHER });

    await expect(
      refusal(service.update(ID, { parentId: TOP }, context)),
    ).resolves.toEqual(
      refused(
        'This category has subcategories, so it cannot sit inside another. Move them first.',
      ),
    );
    expect(tx.category.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown category before anything else', async () => {
    const { service, tx } = moveSetup([{ id: TOP, parentId: null }]);

    await expect(
      service.update(ID, { parentId: TOP }, context),
    ).rejects.toThrow(new NotFoundException('Category not found'));
    expect(tx.category.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.category.update).not.toHaveBeenCalled();
  });
});
