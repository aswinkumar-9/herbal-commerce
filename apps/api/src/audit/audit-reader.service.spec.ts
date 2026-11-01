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

function setup(rows: object[] = [], users: object[] = []) {
  const prisma = {
    auditLog: { findMany: jest.fn().mockResolvedValue(rows) },
    user: { findMany: jest.fn().mockResolvedValue(users) },
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
});
