import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import type { AuditService } from '../audit/audit.service';
import { hashToken } from '../auth/token.util';
import type { Env } from '../config/env';
import type { PrismaService } from '../prisma/prisma.service';
import { SetupLinksService } from './setup-links.service';
import { StaffMfaService } from './staff-mfa.service';

const TOKEN = 'the-token-from-the-emailed-link-1234567890ab';
const KEY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const OTHER_KEY = 'KRUGS4ZANFZSAYJAONSWG4TFOQ2DCMZQ';

function setup() {
  const config = {
    get: (name: string) =>
      name === 'ADMIN_ORIGIN'
        ? 'http://localhost:5173'
        : 'test-mfa-key-material-'.repeat(3),
  };
  // The real one: keys are sealed and opened as they will be.
  const mfa = new StaffMfaService(
    {} as PrismaService,
    {} as AuditService,
    config as unknown as ConfigService<Env, true>,
  );
  const stored = (changes: object = {}) => ({
    id: 'link-1',
    userId: 'admin-1',
    purpose: 'INVITE',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    usedAt: null,
    pendingMfaSecret: null as string | null,
    user: {
      role: 'ADMIN',
      status: 'ACTIVE',
      email: 'dev.admin1@example.com',
      fullName: 'Dev Admin',
      emailVerifiedAt: null as Date | null,
    },
    ...changes,
  });
  const prisma = {
    staffInvitation: {
      findUnique: jest.fn().mockResolvedValue(stored()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const logger = { info: jest.fn() };
  const service = new SetupLinksService(
    prisma as unknown as PrismaService,
    mfa,
    config as unknown as ConfigService<Env, true>,
    logger as unknown as PinoLogger,
  );
  return { service, prisma, mfa, logger, stored };
}

describe('SetupLinksService.url', () => {
  it("points each kind of link at its page on the console's own address", () => {
    const { service } = setup();

    expect(service.url('INVITE', 'a+b/c')).toBe(
      'http://localhost:5173/accept-invite?token=a%2Bb%2Fc',
    );
    expect(service.url('AUTHENTICATOR_RESET', 'abc')).toBe(
      'http://localhost:5173/reset-authenticator?token=abc',
    );
  });
});

describe('SetupLinksService.usable', () => {
  it('finds the link by the hash of its token, with the key shown for it opened', async () => {
    const { service, prisma, mfa, stored } = setup();
    prisma.staffInvitation.findUnique.mockResolvedValue(
      stored({ pendingMfaSecret: mfa.seal(KEY, 'link-1') }),
    );

    await expect(service.usable(TOKEN, 'INVITE')).resolves.toEqual({
      id: 'link-1',
      userId: 'admin-1',
      purpose: 'INVITE',
      expiresAt: expect.any(Date),
      email: 'dev.admin1@example.com',
      fullName: 'Dev Admin',
      secret: KEY,
    });
    expect(prisma.staffInvitation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashToken(TOKEN) } }),
    );
  });

  it('refuses an unknown, mistaken, used or expired link, a disabled Admin and anyone else, with one answer for each kind', async () => {
    const past = new Date(Date.now() - 1000);
    const cases = [
      [null, 'INVITE', 'unknown_token', 'Invalid or expired invitation link'],
      [null, 'AUTHENTICATOR_RESET', 'unknown_token', 'Invalid or expired link'],
      [
        { purpose: 'AUTHENTICATOR_RESET' },
        'INVITE',
        'wrong_purpose',
        'Invalid or expired invitation link',
      ],
      [{ usedAt: past }, 'INVITE', 'already_used', 'Invalid or expired invitation link'],
      [{ expiresAt: past }, 'INVITE', 'expired', 'Invalid or expired invitation link'],
      [
        { user: { role: 'ADMIN', status: 'DISABLED', email: 'x', fullName: 'x', emailVerifiedAt: null } },
        'INVITE',
        'not_allowed',
        'Invalid or expired invitation link',
      ],
      [
        { user: { role: 'SUPER_USER', status: 'ACTIVE', email: 'x', fullName: 'x', emailVerifiedAt: past } },
        'INVITE',
        'not_allowed',
        'Invalid or expired invitation link',
      ],
      // A new start for the app is only for an Admin who accepted.
      [
        { purpose: 'AUTHENTICATOR_RESET' },
        'AUTHENTICATOR_RESET',
        'not_allowed',
        'Invalid or expired link',
      ],
    ] as const;
    for (const [changes, purpose, reason, message] of cases) {
      const { service, prisma, stored, logger } = setup();
      prisma.staffInvitation.findUnique.mockResolvedValue(
        changes === null ? null : stored(changes),
      );

      await expect(service.usable(TOKEN, purpose)).rejects.toMatchObject({
        status: 400,
        message,
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ reason }),
        'Staff link refused',
      );
      expect(JSON.stringify(logger.info.mock.calls)).not.toContain(TOKEN);
    }
  });
});

describe('SetupLinksService.key', () => {
  it('makes a key the first time a link is opened, keeps it sealed for the link, and shows it', async () => {
    const { service, prisma, mfa, stored } = setup();
    // The link, then what the update kept.
    prisma.staffInvitation.findUnique
      .mockResolvedValueOnce(stored())
      .mockImplementationOnce(async () => ({
        pendingMfaSecret: (
          prisma.staffInvitation.updateMany.mock.calls[0][0] as {
            data: { pendingMfaSecret: string };
          }
        ).data.pendingMfaSecret,
      }));

    const answer = await service.key(TOKEN);

    // Atomic: only where no key was kept yet.
    const [update] = prisma.staffInvitation.updateMany.mock.calls[0] as [
      { where: object; data: { pendingMfaSecret: string } },
    ];
    expect(update.where).toEqual({ id: 'link-1', pendingMfaSecret: null });
    expect(update.data.pendingMfaSecret).not.toContain(answer.key);
    expect(mfa.open(update.data.pendingMfaSecret, 'link-1')).toBe(answer.key);
    expect(answer).toEqual({
      purpose: 'INVITE',
      email: 'dev.admin1@example.com',
      fullName: 'Dev Admin',
      key: expect.stringMatching(/^[A-Z2-7]{32}$/),
      uri: expect.stringMatching(/^otpauth:\/\/totp\//),
      expiresAt: expect.any(Date),
    });
    expect(answer.uri).toContain(`secret=${answer.key}`);
  });

  it('shows the same key when the link is opened again, and makes no new one', async () => {
    const { service, prisma, mfa, stored } = setup();
    prisma.staffInvitation.findUnique.mockResolvedValue(
      stored({ pendingMfaSecret: mfa.seal(KEY, 'link-1') }),
    );

    await expect(service.key(TOKEN)).resolves.toMatchObject({ key: KEY });
    expect(prisma.staffInvitation.updateMany).not.toHaveBeenCalled();
  });

  it('shows the key of the page that won, when two were opened at the same moment', async () => {
    const { service, prisma, mfa, stored } = setup();
    prisma.staffInvitation.updateMany.mockResolvedValue({ count: 0 });
    prisma.staffInvitation.findUnique
      .mockResolvedValueOnce(stored())
      .mockResolvedValueOnce({ pendingMfaSecret: mfa.seal(OTHER_KEY, 'link-1') });

    await expect(service.key(TOKEN)).resolves.toMatchObject({ key: OTHER_KEY });
  });

  it('refuses a link that cannot be used, and makes no key', async () => {
    const { service, prisma, stored } = setup();
    prisma.staffInvitation.findUnique.mockResolvedValue(
      stored({ usedAt: new Date() }),
    );

    await expect(service.key(TOKEN)).rejects.toMatchObject({ status: 400 });
    expect(prisma.staffInvitation.updateMany).not.toHaveBeenCalled();
  });
});
