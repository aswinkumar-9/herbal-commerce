import { ConflictException, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { BrandsService } from './brands.service';

const ID = '3f6c1a2e-9b4d-4c7e-8a15-6d2f0e9b7c41';
const createdAt = new Date('2026-11-23T09:15:00.000Z');
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};

// A brand as the query returns it.
function stored(changes: object = {}) {
  return {
    id: ID,
    name: 'Himalaya',
    slug: 'himalaya',
    createdAt,
    updatedAt: createdAt,
    ...changes,
  };
}

// The error Prisma gives when the unique index refuses a slug.
const slugClash = Object.assign(new Error('Unique constraint failed'), {
  code: 'P2002',
});

function setup(rows: object[] = []) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: ID }]),
    brand: {
      create: jest.fn().mockResolvedValue(stored()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(stored()),
      update: jest.fn().mockResolvedValue(stored({ name: 'Himalaya Herbals' })),
      delete: jest.fn().mockResolvedValue({ id: ID }),
    },
  };
  const prisma = {
    brand: { findMany: jest.fn().mockResolvedValue(rows) },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const logger = { info: jest.fn() };
  const service = new BrandsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, audit, logger };
}

describe('BrandsService.list', () => {
  it('lists every brand by name, each with how many products have it', async () => {
    const { service, prisma } = setup([
      { ...stored(), _count: { products: 3 } },
    ]);

    await expect(service.list()).resolves.toEqual({
      brands: [{ ...stored(), productCount: 3 }],
    });

    const [query] = prisma.brand.findMany.mock.calls[0] as [
      { where?: object; orderBy: object; select: Record<string, unknown> },
    ];
    expect(query.where).toBeUndefined();
    expect(query.orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    expect(query.select).toEqual({
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { products: true } },
    });
  });
});

describe('BrandsService.listShown', () => {
  it('lists by name only the brands with a live product in a category customers see, without IDs', async () => {
    const shown = [{ name: 'Himalaya', slug: 'himalaya' }];
    const { service, prisma } = setup(shown);

    await expect(service.listShown()).resolves.toEqual({ brands: shown });
    expect(prisma.brand.findMany).toHaveBeenCalledWith({
      where: {
        products: {
          some: {
            isActive: true,
            category: {
              isActive: true,
              OR: [{ parentId: null }, { parent: { isActive: true } }],
            },
          },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { name: true, slug: true },
    });
  });
});

describe('BrandsService.create', () => {
  it('saves the brand and records who created it, in the same transaction', async () => {
    const { service, tx, audit, logger } = setup();
    const input = { name: 'Himalaya', slug: 'himalaya' };

    await expect(service.create(input, context)).resolves.toEqual(stored());

    expect(tx.brand.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: input }),
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'brand.created',
      targetType: 'brand',
      targetId: ID,
      after: { name: 'Himalaya', slug: 'himalaya' },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { brandId: ID, actorId: context.actorId },
      'Brand created',
    );
  });

  it('answers 409 when another brand has the slug, and records nothing', async () => {
    const { service, tx, audit, logger } = setup();
    tx.brand.create.mockRejectedValue(slugClash);

    await expect(
      service.create({ name: 'HIMALAYA', slug: 'himalaya' }, context),
    ).rejects.toThrow(
      new ConflictException(
        'Another brand already has this slug. Choose a different one.',
      ),
    );
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('passes on any other error unchanged', async () => {
    const { service, tx } = setup();
    const broken = new Error('connection lost');
    tx.brand.create.mockRejectedValue(broken);

    await expect(
      service.create({ name: 'Himalaya', slug: 'himalaya' }, context),
    ).rejects.toBe(broken);
  });
});

describe('BrandsService.update', () => {
  it('locks the brand first, so the audit entry shows exactly what changed', async () => {
    const { service, tx } = setup();

    await service.update(ID, { name: 'Himalaya Herbals' }, context);

    const [sql, id] = tx.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join('?')).toMatch(/FROM brands WHERE id = \?::uuid FOR UPDATE/);
    // A parameter, never pasted into the SQL.
    expect(id).toBe(ID);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.brand.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
  });

  it('saves only the fields that change, and records them before and after', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(
      service.update(
        ID,
        { name: 'Himalaya Herbals', slug: 'himalaya' },
        context,
      ),
    ).resolves.toEqual(stored({ name: 'Himalaya Herbals' }));

    expect(tx.brand.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ID },
        data: { name: 'Himalaya Herbals' },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'brand.updated',
      targetType: 'brand',
      targetId: ID,
      before: { name: 'Himalaya' },
      after: { name: 'Himalaya Herbals' },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { brandId: ID, actorId: context.actorId },
      'Brand changed',
    );
  });

  it('changes and records nothing when every value is already the same', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(
      service.update(ID, { name: 'Himalaya' }, context),
    ).resolves.toEqual(stored());

    expect(tx.brand.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown ID, and changes nothing', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      service.update(ID, { name: 'Himalaya Herbals' }, context),
    ).rejects.toThrow(new NotFoundException('Brand not found'));
    expect(tx.brand.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('answers 409 when the new slug belongs to another brand', async () => {
    const { service, tx, audit } = setup();
    tx.brand.update.mockRejectedValue(slugClash);

    await expect(
      service.update(ID, { slug: 'dabur' }, context),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('BrandsService.remove', () => {
  it('locks the brand, deletes it, and records what it was in the same transaction', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(service.remove(ID, context)).resolves.toBeUndefined();

    const [sql, id] = tx.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join('?')).toMatch(/FROM brands WHERE id = \?::uuid FOR UPDATE/);
    expect(id).toBe(ID);
    expect(tx.brand.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID } }),
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.brand.delete.mock.invocationCallOrder[0],
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'brand.deleted',
      targetType: 'brand',
      targetId: ID,
      before: { name: 'Himalaya', slug: 'himalaya' },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { brandId: ID, actorId: context.actorId },
      'Brand deleted',
    );
  });

  it('answers 404 for an unknown ID, and deletes nothing', async () => {
    const { service, tx, audit, logger } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(service.remove(ID, context)).rejects.toThrow(
      new NotFoundException('Brand not found'),
    );
    expect(tx.brand.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('answers 409 while a product still has the brand, and records nothing', async () => {
    const { service, tx, audit, logger } = setup();
    tx.brand.delete.mockRejectedValue(
      Object.assign(new Error('Foreign key constraint violated'), {
        code: 'P2003',
      }),
    );

    await expect(service.remove(ID, context)).rejects.toThrow(
      new ConflictException(
        'This brand still has products. Choose another brand for them, or none, first.',
      ),
    );
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('passes on any other error unchanged', async () => {
    const { service, tx } = setup();
    const broken = new Error('connection lost');
    tx.brand.delete.mockRejectedValue(broken);

    await expect(service.remove(ID, context)).rejects.toBe(broken);
  });
});
