import { ConflictException, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesService } from './categories.service';

const ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
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
    createdAt,
    updatedAt: createdAt,
    ...changes,
  };
}

// The error Prisma gives when the unique index refuses a slug.
const slugClash = Object.assign(new Error('Unique constraint failed'), {
  code: 'P2002',
});

function setup(categories: object[] = []) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: ID }]),
    category: {
      create: jest.fn().mockResolvedValue(stored()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(stored()),
      update: jest.fn().mockResolvedValue(stored({ isActive: true })),
      delete: jest.fn().mockResolvedValue({ id: ID }),
    },
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
      'position',
      'slug',
      'updatedAt',
    ]);
  });
});

describe('CategoriesService.listActive', () => {
  it('lists only active categories, in the same order, with only what a shop page needs', async () => {
    const shown = { name: 'Hair Care', slug: 'hair-care', description: null };
    const { service, prisma } = setup([shown]);

    await expect(service.listActive()).resolves.toEqual({
      categories: [shown],
    });

    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: { name: true, slug: true, description: true },
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
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { categoryId: ID, actorId: context.actorId },
      'Category created',
    );
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

    const [sql, id] = tx.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join('?')).toMatch(/FROM categories WHERE id = \?::uuid FOR UPDATE/);
    // A parameter, never pasted into the SQL.
    expect(id).toBe(ID);
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

    const [sql, id] = tx.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join('?')).toMatch(/FROM categories WHERE id = \?::uuid FOR UPDATE/);
    expect(id).toBe(ID);
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
