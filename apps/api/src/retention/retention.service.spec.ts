import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../prisma/prisma.service';
import { RetentionService } from './retention.service';

const NOW = new Date('2026-10-27T12:00:00Z');
const daysBefore = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

function setup() {
  const deleted = (count: number) => jest.fn().mockResolvedValue({ count });
  const prisma = {
    session: { deleteMany: deleted(3) },
    refreshToken: { deleteMany: deleted(40) },
    emailVerificationToken: { deleteMany: deleted(5) },
    passwordResetToken: { deleteMany: deleted(2) },
    staffInvitation: { deleteMany: deleted(4) },
    user: { deleteMany: deleted(1) },
  };
  const logger = { info: jest.fn() };
  const service = new RetentionService(
    prisma as unknown as PrismaService,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, logger };
}

describe('RetentionService.purge', () => {
  it('deletes sessions that expired or were revoked more than 30 days ago', async () => {
    const { service, prisma } = setup();
    await service.purge(NOW);

    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: { lt: daysBefore(30) } },
          { revokedAt: { lt: daysBefore(30) } },
        ],
      },
    });
  });

  it('deletes refresh tokens used more than 7 days ago', async () => {
    const { service, prisma } = setup();
    await service.purge(NOW);

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { usedAt: { lt: daysBefore(7) } },
    });
  });

  it('deletes verification and reset links once they have expired', async () => {
    const { service, prisma } = setup();
    await service.purge(NOW);

    expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: NOW } },
    });
    expect(prisma.passwordResetToken.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: NOW } },
    });
  });

  it('deletes Admin invitations once they have expired, used or not', async () => {
    const { service, prisma } = setup();
    await service.purge(NOW);

    expect(prisma.staffInvitation.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: NOW } },
    });
  });

  it('deletes customer sign-ups still unverified after 7 days, and never staff', async () => {
    const { service, prisma } = setup();
    await service.purge(NOW);

    expect(prisma.user.deleteMany).toHaveBeenCalledWith({
      where: {
        role: 'CUSTOMER',
        emailVerifiedAt: null,
        createdAt: { lt: daysBefore(7) },
      },
    });
  });

  it('reports and logs how many rows it deleted, and nothing else', async () => {
    const { service, logger } = setup();

    const counts = {
      sessions: 3,
      refreshTokens: 40,
      verificationTokens: 5,
      resetTokens: 2,
      staffInvitations: 4,
      unverifiedAccounts: 1,
    };
    await expect(service.purge(NOW)).resolves.toEqual(counts);
    expect(logger.info).toHaveBeenCalledWith(counts, 'Retention cleanup finished');
  });
});
