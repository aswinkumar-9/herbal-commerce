import { PrismaService } from '../prisma/prisma.service';
import { AdminsService } from './admins.service';

const createdAt = new Date('2026-10-30T11:28:51.000Z');

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
  const prisma = { user: { findMany: jest.fn().mockResolvedValue(admins) } };
  const service = new AdminsService(prisma as unknown as PrismaService);
  return { service, prisma };
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
