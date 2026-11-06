import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { VariantsService } from './variants.service';

const ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PRODUCT = '3f2b8c1d-5e6a-4b7c-8d9e-0f1a2b3c4d5e';
const createdAt = new Date('2026-11-04T09:15:00.000Z');
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};

// What staff set, and the product it belongs to.
const packFields = {
  productId: PRODUCT,
  sku: 'ASH-CAP-60',
  quantity: 60,
  unit: 'CAPSULES',
  mrpRupees: 500,
  priceRupees: 450,
  isActive: true,
  position: 0,
};
const input = {
  sku: 'ASH-CAP-60',
  quantity: 60,
  unit: 'CAPSULES' as const,
  mrpRupees: 500,
  priceRupees: 450,
};

// A pack size as the query returns it.
function stored(changes: object = {}) {
  return { id: ID, ...packFields, createdAt, updatedAt: createdAt, ...changes };
}

const withCode = (code: string) =>
  Object.assign(new Error('Prisma error'), { code });

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: ID }]),
    productVariant: {
      create: jest.fn().mockResolvedValue(stored()),
      findUniqueOrThrow: jest.fn().mockResolvedValue(stored()),
      update: jest.fn().mockResolvedValue(stored({ priceRupees: 400 })),
      delete: jest.fn().mockResolvedValue({ id: ID }),
    },
  };
  const prisma = {
    product: {
      findUnique: jest.fn().mockResolvedValue({ variants: [stored()] }),
    },
    productVariant: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const logger = { info: jest.fn() };
  const service = new VariantsService(
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

describe('VariantsService.listForProduct', () => {
  it("lists every pack size of the product, by position and then size", async () => {
    const { service, prisma } = setup();

    await expect(service.listForProduct(PRODUCT)).resolves.toEqual({
      variants: [stored()],
    });

    const [query] = prisma.product.findUnique.mock.calls[0] as [
      {
        where: object;
        select: { variants: { orderBy: object; select: Record<string, boolean> } };
      },
    ];
    expect(query.where).toEqual({ id: PRODUCT });
    expect(query.select.variants.orderBy).toEqual([
      { position: 'asc' },
      { quantity: 'asc' },
      { id: 'asc' },
    ]);
    expect(Object.keys(query.select.variants.select).sort()).toEqual(
      ['id', ...Object.keys(packFields), 'createdAt', 'updatedAt'].sort(),
    );
  });

  it('answers 404 for a product that does not exist', async () => {
    const { service, prisma } = setup();
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(service.listForProduct(PRODUCT)).rejects.toThrow(
      new NotFoundException('Product not found'),
    );
  });
});

describe('VariantsService.create', () => {
  it('saves the pack size for the product and records it, in the same transaction', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(service.create(PRODUCT, input, context)).resolves.toEqual(
      stored(),
    );

    expect(tx.productVariant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ...input, productId: PRODUCT } }),
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'variant.created',
      targetType: 'variant',
      targetId: ID,
      after: packFields,
    });
    expect(logger.info).toHaveBeenCalledWith(
      { variantId: ID, productId: PRODUCT, actorId: context.actorId },
      'Pack size created',
    );
  });

  it('answers 404 when the product does not exist', async () => {
    const { service, tx, audit } = setup();
    tx.productVariant.create.mockRejectedValue(withCode('P2003'));

    await expect(service.create(PRODUCT, input, context)).rejects.toThrow(
      new NotFoundException('Product not found'),
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('says which unique rule a clash broke: the SKU, or the pack size', async () => {
    const { service, prisma, tx } = setup();
    tx.productVariant.create.mockRejectedValue(withCode('P2002'));

    prisma.productVariant.findUnique.mockResolvedValue({ id: 'another-pack' });
    await expect(service.create(PRODUCT, input, context)).rejects.toThrow(
      new ConflictException(
        'Another pack size already has this SKU. Choose a different one.',
      ),
    );
    expect(prisma.productVariant.findUnique).toHaveBeenCalledWith({
      where: { sku: 'ASH-CAP-60' },
      select: { id: true },
    });

    prisma.productVariant.findUnique.mockResolvedValue(null);
    await expect(service.create(PRODUCT, input, context)).rejects.toThrow(
      new ConflictException('This product already has a pack of this size.'),
    );
  });

  it('passes on any other error unchanged', async () => {
    const { service, tx } = setup();
    const broken = new Error('connection lost');
    tx.productVariant.create.mockRejectedValue(broken);

    await expect(service.create(PRODUCT, input, context)).rejects.toBe(broken);
  });
});

describe('VariantsService.update', () => {
  it('locks the pack size first, so the price check and the audit entry see it as it is', async () => {
    const { service, tx } = setup();

    await service.update(ID, { priceRupees: 400 }, context);

    const [sql, id] = tx.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join('?')).toMatch(
      /FROM product_variants WHERE id = \?::uuid FOR UPDATE/,
    );
    expect(id).toBe(ID);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.productVariant.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
  });

  it('saves only the fields that change, and records the old and new price', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(
      service.update(ID, { priceRupees: 400, mrpRupees: 500 }, context),
    ).resolves.toEqual(stored({ priceRupees: 400 }));

    expect(tx.productVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID }, data: { priceRupees: 400 } }),
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'variant.updated',
      targetType: 'variant',
      targetId: ID,
      before: { priceRupees: 450 },
      after: { priceRupees: 400 },
    });
    expect(logger.info).toHaveBeenCalledWith(
      { variantId: ID, actorId: context.actorId },
      'Pack size changed',
    );
  });

  it('refuses a lower MRP that falls below the stored price, and a price above the stored MRP', async () => {
    const { service, tx, audit } = setup();

    for (const change of [{ mrpRupees: 400 }, { priceRupees: 550 }]) {
      await expect(refusal(service.update(ID, change, context))).resolves.toEqual({
        message: 'Validation failed',
        errors: [
          { field: 'priceRupees', message: 'The price may not be more than the MRP' },
        ],
      });
    }
    expect(tx.productVariant.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('lets the MRP and the price change together', async () => {
    const { service, tx } = setup();

    await service.update(ID, { mrpRupees: 400, priceRupees: 380 }, context);
    expect(tx.productVariant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { mrpRupees: 400, priceRupees: 380 } }),
    );
  });

  it('changes and records nothing when every value is already the same', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(
      service.update(ID, { priceRupees: 450, isActive: true }, context),
    ).resolves.toEqual(stored());
    expect(tx.productVariant.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown ID, and changes nothing', async () => {
    const { service, tx, audit } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      service.update(ID, { priceRupees: 400 }, context),
    ).rejects.toThrow(new NotFoundException('Pack size not found'));
    expect(tx.productVariant.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("says a clash is about the size when the pack keeps its own SKU", async () => {
    const { service, prisma, tx } = setup();
    tx.productVariant.update.mockRejectedValue(withCode('P2002'));

    // The SKU sent is this pack's own: the clash must be the size.
    prisma.productVariant.findUnique.mockResolvedValue({ id: ID });
    await expect(
      service.update(ID, { sku: 'ASH-CAP-60X', quantity: 120 }, context),
    ).rejects.toThrow(
      new ConflictException('This product already has a pack of this size.'),
    );
    // No SKU sent: nothing to look up.
    prisma.productVariant.findUnique.mockClear();
    await expect(
      service.update(ID, { quantity: 120 }, context),
    ).rejects.toThrow(
      new ConflictException('This product already has a pack of this size.'),
    );
    expect(prisma.productVariant.findUnique).not.toHaveBeenCalled();
  });
});

describe('VariantsService.remove', () => {
  it('locks the pack size, deletes it, and records what it was in the same transaction', async () => {
    const { service, tx, audit, logger } = setup();

    await expect(service.remove(ID, context)).resolves.toBeUndefined();

    const [sql, id] = tx.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join('?')).toMatch(
      /FROM product_variants WHERE id = \?::uuid FOR UPDATE/,
    );
    expect(id).toBe(ID);
    expect(tx.productVariant.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ID } }),
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.productVariant.delete.mock.invocationCallOrder[0],
    );
    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'variant.deleted',
      targetType: 'variant',
      targetId: ID,
      before: packFields,
    });
    expect(logger.info).toHaveBeenCalledWith(
      { variantId: ID, actorId: context.actorId },
      'Pack size deleted',
    );
  });

  it('answers 409 when the pack size still holds stock, which the database refuses to delete', async () => {
    const { service, tx, logger } = setup();
    tx.productVariant.delete.mockRejectedValue(
      Object.assign(new Error('Prisma error'), { code: 'P2003' }),
    );

    await expect(service.remove(ID, context)).rejects.toThrow(
      new ConflictException(
        'This pack size still has stock. Write it off first, then delete it.',
      ),
    );
    expect(logger.info).not.toHaveBeenCalled();

    const broken = new Error('Database unavailable');
    tx.productVariant.delete.mockRejectedValue(broken);
    await expect(service.remove(ID, context)).rejects.toBe(broken);
  });

  it('answers 404 for an unknown ID, and deletes nothing', async () => {
    const { service, tx, audit, logger } = setup();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(service.remove(ID, context)).rejects.toThrow(
      new NotFoundException('Pack size not found'),
    );
    expect(tx.productVariant.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
