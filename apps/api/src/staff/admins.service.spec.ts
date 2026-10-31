import { NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminsService } from './admins.service';

const createdAt = new Date('2026-10-30T11:28:51.000Z');
const context = {
  actorId: '5d1e8c2a-7b3f-4e9a-a1c6-2f8d0b4e7a93',
  ip: '203.0.113.7',
  requestId: 'request-1',
};

// An Admin as the query returns it.
function storedAdmin(changes: object = {}) {
  return {
    id: 'admin-1',
    email: 'dev.admin1@example.com',
    fullName: 'Dev Admin One',
    status: 'ACTIVE',
    emailVerifiedAt: null,
    mfaEnabledAt: null,
    createdAt,
    staffInvitations: [],
    ...changes,
  };
}

function setup(admins: object[] = []) {
  const tx = {
    user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue(admins),
      findFirst: jest.fn().mockResolvedValue(storedAdmin()),
    },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const logger = { info: jest.fn() };
  const service = new AdminsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, tx, audit, logger };
}

describe('AdminsService.list', () => {
  it('lists only Admins, oldest first, never the password hash or the MFA secret', async () => {
    const { service, prisma } = setup();

    await expect(service.list()).resolves.toEqual({ admins: [] });

    const [query] = prisma.user.findMany.mock.calls[0] as [
      { where: object; orderBy: object; select: Record<string, unknown> },
    ];
    expect(query.where).toEqual({ role: 'ADMIN' });
    expect(query.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(Object.keys(query.select).sort()).toEqual([
      'createdAt',
      'email',
      'emailVerifiedAt',
      'fullName',
      'id',
      'mfaEnabledAt',
      'staffInvitations',
      'status',
    ]);
    // Only the newest unused invitation, and only when it ends.
    expect(query.select.staffInvitations).toEqual({
      where: { usedAt: null },
      orderBy: { expiresAt: 'desc' },
      take: 1,
      select: { expiresAt: true },
    });
  });

  it('shows whether each Admin has accepted and when a pending invitation ends', async () => {
    const acceptedAt = new Date('2026-10-30T11:43:18.000Z');
    const mfaAt = new Date('2026-10-30T11:47:36.000Z');
    const invitationEnds = new Date('2026-11-02T11:28:51.000Z');
    const { service } = setup([
      storedAdmin({ emailVerifiedAt: acceptedAt, mfaEnabledAt: mfaAt }),
      storedAdmin({
        id: 'admin-2',
        email: 'dev.admin2@example.com',
        status: 'DISABLED',
        staffInvitations: [{ expiresAt: invitationEnds }],
      }),
    ]);

    await expect(service.list()).resolves.toEqual({
      admins: [
        {
          id: 'admin-1',
          email: 'dev.admin1@example.com',
          fullName: 'Dev Admin One',
          status: 'ACTIVE',
          invitationAcceptedAt: acceptedAt,
          invitationExpiresAt: null,
          mfaEnabledAt: mfaAt,
          createdAt,
        },
        {
          id: 'admin-2',
          email: 'dev.admin2@example.com',
          fullName: 'Dev Admin One',
          status: 'DISABLED',
          invitationAcceptedAt: null,
          invitationExpiresAt: invitationEnds,
          mfaEnabledAt: null,
          createdAt,
        },
      ],
    });
  });
});

describe('AdminsService.setStatus', () => {
  it('disables only an Admin, atomically, and ends all their sessions', async () => {
    const { service, prisma, tx } = setup();
    prisma.user.findFirst.mockResolvedValue(
      storedAdmin({ status: 'DISABLED' }),
    );

    await expect(
      service.setStatus('admin-1', 'DISABLED', context),
    ).resolves.toMatchObject({ id: 'admin-1', status: 'DISABLED' });

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'admin-1', role: 'ADMIN', status: { not: 'DISABLED' } },
      data: { status: 'DISABLED' },
    });
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'admin-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
    // The answer is read only after the change, and only for an Admin.
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'admin-1', role: 'ADMIN' } }),
    );
  });

  it('records who disabled the Admin in the same transaction, with before and after', async () => {
    const { service, tx, audit } = setup();

    await service.setStatus('admin-1', 'DISABLED', context);

    expect(audit.record).toHaveBeenCalledWith(tx, {
      ...context,
      action: 'admin.disabled',
      targetType: 'user',
      targetId: 'admin-1',
      before: { status: 'ACTIVE' },
      after: { status: 'DISABLED' },
    });
  });

  it('enables an Admin without touching sessions, and records it', async () => {
    const { service, tx, audit } = setup();

    await service.setStatus('admin-1', 'ACTIVE', context);

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'admin-1', role: 'ADMIN', status: { not: 'ACTIVE' } },
      data: { status: 'ACTIVE' },
    });
    expect(tx.session.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'admin.enabled',
        before: { status: 'DISABLED' },
        after: { status: 'ACTIVE' },
      }),
    );
  });

  it('changes and records nothing when the Admin already has that status', async () => {
    const { service, tx, audit, logger } = setup();
    tx.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.setStatus('admin-1', 'ACTIVE', context),
    ).resolves.toMatchObject({ id: 'admin-1', status: 'ACTIVE' });

    expect(tx.session.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown ID, or one that is not an Admin', async () => {
    const { service, prisma, tx, audit } = setup();
    tx.user.updateMany.mockResolvedValue({ count: 0 });
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.setStatus('super-1', 'DISABLED', context),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.session.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
