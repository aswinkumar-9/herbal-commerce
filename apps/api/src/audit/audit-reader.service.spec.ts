import { PrismaService } from '../prisma/prisma.service';
import { AuditReaderService } from './audit-reader.service';

const SUPER = {
  id: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  email: 'dev.super1@example.com',
  fullName: 'Dev Super One',
  role: 'SUPER_USER',
};
const ADMIN = {
  id: '3c9a7e21-5b4d-4f8e-9a16-7d2e0c5b8f41',
  email: 'dev.admin1@example.com',
  fullName: 'Dev Admin One',
  role: 'ADMIN',
};
type NamedModel =
  | 'category'
  | 'product'
  | 'productVariant'
  | 'productImage'
  | 'stockBatch'
  | 'order';
const NAMED_MODELS: NamedModel[] = [
  'category',
  'product',
  'productVariant',
  'productImage',
  'stockBatch',
  'order',
];
const ID = (n: number) => `a${n}a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1`;
const REMOVED_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const SESSION_ID = '7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2910';

// An entry as stored, newest first by its number.
function entry(n: number, changes: object = {}) {
  return {
    id: `entry-${n}`,
    createdAt: new Date(Date.UTC(2026, 9, 31, 12, 0, 60 - n)),
    actorId: null,
    action: 'admin.disabled',
    targetType: null,
    targetId: null,
    before: null,
    after: null,
    ip: '203.0.113.7',
    requestId: `request-${n}`,
    ...changes,
  };
}

function setup(
  rows: object[] = [],
  users: object[] = [],
  named: Partial<Record<NamedModel, object[]>> = {},
) {
  const lookup = (model: NamedModel) => ({
    findMany: jest.fn().mockResolvedValue(named[model] ?? []),
  });
  const prisma = {
    auditLog: { findMany: jest.fn().mockResolvedValue(rows) },
    user: { findMany: jest.fn().mockResolvedValue(users) },
    category: lookup('category'),
    product: lookup('product'),
    productVariant: lookup('productVariant'),
    productImage: lookup('productImage'),
    stockBatch: lookup('stockBatch'),
    order: lookup('order'),
  };
  const service = new AuditReaderService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('AuditReaderService.list', () => {
  it('reads newest first, one entry more than asked for, unfiltered by default', async () => {
    const { service, prisma } = setup();

    await expect(service.list({ limit: 50 })).resolves.toEqual({
      entries: [],
      nextBefore: null,
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: { action: undefined, actorId: undefined, targetId: undefined },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
    });
  });

  it('combines the filters it is given', async () => {
    const { service, prisma } = setup();

    await service.list({
      limit: 10,
      action: 'admin.removed',
      actorId: SUPER.id,
      targetId: ADMIN.id,
    });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          action: 'admin.removed',
          actorId: SUPER.id,
          targetId: ADMIN.id,
        },
      }),
    );
  });

  it('starts just after the given entry for the next page', async () => {
    const { service, prisma } = setup();

    await service.list({ limit: 10, before: 'entry-10' });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'entry-10' },
        skip: 1,
        take: 11,
      }),
    );
  });

  it('points to the next page only when an older entry exists', async () => {
    const three = [entry(1), entry(2), entry(3)];

    const full = await setup(three).service.list({ limit: 2 });
    expect(full.entries.map((e) => e.id)).toEqual(['entry-1', 'entry-2']);
    expect(full.nextBefore).toBe('entry-2');

    const last = await setup(three).service.list({ limit: 3 });
    expect(last.entries).toHaveLength(3);
    expect(last.nextBefore).toBeNull();
  });

  it('names the actor and a user target, in one query, with only four fields', async () => {
    const { service, prisma } = setup(
      [
        entry(1, {
          actorId: SUPER.id,
          action: 'admin.disabled',
          targetType: 'user',
          targetId: ADMIN.id,
        }),
        entry(2, {
          actorId: ADMIN.id,
          action: 'admin.invite_accepted',
          targetType: 'user',
          targetId: ADMIN.id,
        }),
      ],
      [SUPER, ADMIN],
    );

    const page = await service.list({ limit: 50 });

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: [SUPER.id, ADMIN.id] } },
      select: { id: true, email: true, fullName: true, role: true },
    });
    expect(page.entries[0]).toMatchObject({ actor: SUPER, target: ADMIN });
    expect(page.entries[1]).toMatchObject({ actor: ADMIN, target: ADMIN });
  });

  it('keeps the bare ID of a removed account, and names nobody for other targets', async () => {
    const { service, prisma } = setup(
      [
        entry(1, {
          actorId: SUPER.id,
          action: 'admin.removed',
          targetType: 'user',
          targetId: REMOVED_ID,
        }),
        entry(2, { targetType: 'session', targetId: SESSION_ID }),
        entry(3, { targetType: 'user', targetId: 'not-a-uuid' }),
      ],
      [SUPER],
    );

    const page = await service.list({ limit: 50 });

    // Only well-formed IDs of user targets are looked up.
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [SUPER.id, REMOVED_ID] } },
      }),
    );
    expect(page.entries[0]).toMatchObject({
      targetId: REMOVED_ID,
      actor: SUPER,
      target: null,
    });
    expect(page.entries[1].target).toBeNull();
    expect(page.entries[2].target).toBeNull();
  });

  it('asks for no accounts when no entry names one', async () => {
    const { service, prisma } = setup([entry(1)]);

    const page = await service.list({ limit: 50 });

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(page.entries[0]).toMatchObject({ actor: null, target: null });
  });

  it('asks for one kind of change only, with the actions it covers (ADR 0038)', async () => {
    const { service, prisma } = setup();

    await service.list({ limit: 50, kind: 'accounts', actorId: ADMIN.id });
    await service.list({ limit: 50, kind: 'sign_ins' });
    await service.list({ limit: 50, kind: 'orders' });
    await service.list({ limit: 50, kind: 'catalog' });
    await service.list({ limit: 50, kind: 'stock' });

    const asked = prisma.auditLog.findMany.mock.calls.map(([q]) => q.where);
    expect(asked[0]).toEqual({
      action: undefined,
      actorId: ADMIN.id,
      targetId: undefined,
      OR: [
        { action: { startsWith: 'admin.' } },
        { action: 'super_user.created' },
        { action: 'staff.mfa_set_up' },
      ],
    });
    expect(asked[1].OR).toEqual([{ action: 'staff.signed_in' }]);
    expect(asked[2].OR).toEqual([{ action: { startsWith: 'order.' } }]);
    expect(asked[3].OR).toEqual([
      { action: { startsWith: 'category.' } },
      { action: { startsWith: 'product.' } },
      { action: { startsWith: 'variant.' } },
      { action: { startsWith: 'image.' } },
    ]);
    expect(asked[4].OR).toEqual([
      { action: { startsWith: 'batch.' } },
      { action: { startsWith: 'stock.' } },
    ]);
  });

  it('says what each target is called now, with what it belongs to, one query for each kind (ADR 0038)', async () => {
    const { service, prisma } = setup(
      [
        entry(1, { targetType: 'order', targetId: ID(1) }),
        entry(2, { targetType: 'product', targetId: ID(2) }),
        entry(3, { targetType: 'variant', targetId: ID(3) }),
        entry(4, { targetType: 'image', targetId: ID(4) }),
        entry(5, { targetType: 'batch', targetId: ID(5) }),
        entry(6, { targetType: 'category', targetId: ID(6) }),
        entry(7, { targetType: 'order', targetId: ID(7) }),
      ],
      [],
      {
        order: [{ id: ID(1), reference: '7KQ2M9XDPA' }],
        product: [{ id: ID(2), name: 'Ashwagandha Capsules' }],
        productVariant: [
          { id: ID(3), sku: 'ASH-CAP-60', product: { id: ID(2), name: 'Ashwagandha Capsules' } },
        ],
        productImage: [
          { id: ID(4), altText: null, product: { id: ID(2), name: 'Ashwagandha Capsules' } },
        ],
        stockBatch: [
          { id: ID(5), batchNumber: 'AB2611', variant: { id: ID(3), sku: 'ASH-CAP-60' } },
        ],
        category: [{ id: ID(6), name: 'Hair Care' }],
      },
    );

    const page = await service.list({ limit: 50 });

    expect(page.entries.map((e) => e.subject)).toEqual([
      { name: '7KQ2M9XDPA', parent: null },
      { name: 'Ashwagandha Capsules', parent: null },
      { name: 'ASH-CAP-60', parent: { id: ID(2), name: 'Ashwagandha Capsules' } },
      { name: null, parent: { id: ID(2), name: 'Ashwagandha Capsules' } },
      { name: 'AB2611', parent: { id: ID(3), name: 'ASH-CAP-60' } },
      { name: 'Hair Care', parent: null },
      // Gone since: nothing to call it.
      null,
    ]);
    expect(prisma.order.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: { id: { in: [ID(1), ID(7)] } },
      select: { id: true, reference: true },
    });
    for (const model of NAMED_MODELS) {
      expect(prisma[model].findMany).toHaveBeenCalledTimes(1);
    }
  });

  it('looks up only the kinds that appear, and only well-formed IDs', async () => {
    const { service, prisma } = setup([
      entry(1, { targetType: 'session', targetId: SESSION_ID }),
      entry(2, { targetType: 'order', targetId: 'not-a-uuid' }),
      entry(3, { targetType: 'user', targetId: ADMIN.id }),
    ]);

    const page = await service.list({ limit: 50 });

    for (const model of NAMED_MODELS) {
      expect(prisma[model].findMany).not.toHaveBeenCalled();
    }
    expect(page.entries.map((e) => e.subject)).toEqual([null, null, null]);
  });
});
