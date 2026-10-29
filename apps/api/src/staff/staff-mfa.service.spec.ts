import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { SecretBox } from '../common/secret-box';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { StaffMfaService } from './staff-mfa.service';
import { base32Decode, hotp, totpStep } from './totp';

type UpdateUserArgs = {
  data: { mfaSecret: string; mfaEnabledAt: Date; mfaLastUsedStep: number };
};

const KEY_MATERIAL = 'test-mfa-key-material-'.repeat(3);
const NOW = 1_700_000_000_000;
const STEP = totpStep(NOW);
const staff = { id: 'staff-1', email: 'dev.super1@example.com', role: 'SUPER_USER' };

// The code an authenticator app would show for this secret at this step.
const codeFor = (secret: string, step = STEP) => hotp(base32Decode(secret), step);

function setup() {
  const tx = {
    user: { update: jest.fn().mockResolvedValue({ id: staff.id }) },
    session: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(staff),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const config = { get: () => KEY_MATERIAL };
  const service = new StaffMfaService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    config as unknown as ConfigService<Env, true>,
  );
  return { service, prisma, tx, audit };
}

describe('StaffMfaService setup', () => {
  it('begins with a new secret and setup link for a staff account, and saves nothing', async () => {
    const { service, prisma, tx } = setup();

    const { userId, secret, uri } = await service.beginSetup(staff.email);

    expect(userId).toBe(staff.id);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('dev.super1%40example.com');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('refuses a customer or an unknown email', async () => {
    const { service, prisma } = setup();

    prisma.user.findUnique.mockResolvedValueOnce({ ...staff, role: 'CUSTOMER' });
    await expect(service.beginSetup(staff.email)).rejects.toThrow('No staff account');
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.beginSetup(staff.email)).rejects.toThrow('No staff account');
  });

  it('saves the secret encrypted, ends all sessions and audits it, when the code is right', async () => {
    const { service, tx, audit } = setup();
    const { secret } = await service.beginSetup(staff.email);

    await expect(
      service.confirmSetup(staff.id, secret, codeFor(secret), NOW),
    ).resolves.toBe(true);

    const { data } = tx.user.update.mock.calls[0][0] as UpdateUserArgs;
    expect(data.mfaSecret.startsWith('v1.')).toBe(true);
    expect(data.mfaSecret).not.toContain(secret);
    // Bound to this user: it opens for staff-1, with the MFA key and purpose.
    expect(
      new SecretBox(KEY_MATERIAL, 'staff mfa secrets').open(data.mfaSecret, staff.id),
    ).toBe(secret);
    expect(data.mfaLastUsedStep).toBe(STEP);
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: staff.id, revokedAt: null },
      data: { revokedAt: new Date(NOW) },
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      action: 'staff.mfa_set_up',
      targetType: 'user',
      targetId: staff.id,
      after: { mfaEnabled: true },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(secret);
  });

  it('saves nothing when the code is wrong', async () => {
    const { service, prisma } = setup();
    const { secret } = await service.beginSetup(staff.email);

    await expect(
      service.confirmSetup(staff.id, secret, codeFor(secret, STEP + 5), NOW),
    ).resolves.toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('StaffMfaService.verifyAndUse', () => {
  const box = new SecretBox(KEY_MATERIAL, 'staff mfa secrets');
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const sealed = box.seal(secret, staff.id);

  it('accepts a fresh code once and uses it up atomically', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({ mfaSecret: sealed, mfaLastUsedStep: STEP - 3 });

    await expect(service.verifyAndUse(staff.id, codeFor(secret), NOW)).resolves.toBe(true);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: staff.id,
        OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: STEP } }],
      },
      data: { mfaLastUsedStep: STEP },
    });
  });

  it('refuses a code that was already used', async () => {
    const { service, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue({ mfaSecret: sealed, mfaLastUsedStep: STEP });

    await expect(service.verifyAndUse(staff.id, codeFor(secret), NOW)).resolves.toBe(false);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when MFA is not set up, or when another request used the code first', async () => {
    const notSetUp = setup();
    notSetUp.prisma.user.findUnique.mockResolvedValue({ mfaSecret: null, mfaLastUsedStep: null });
    await expect(
      notSetUp.service.verifyAndUse(staff.id, codeFor(secret), NOW),
    ).resolves.toBe(false);

    const lostRace = setup();
    lostRace.prisma.user.findUnique.mockResolvedValue({ mfaSecret: sealed, mfaLastUsedStep: null });
    lostRace.prisma.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      lostRace.service.verifyAndUse(staff.id, codeFor(secret), NOW),
    ).resolves.toBe(false);
  });
});
