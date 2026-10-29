import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { SecretBox } from '../common/secret-box';
import { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

// Staff MFA with an authenticator app (ADR 0013).
@Injectable()
export class StaffMfaService {
  // Encrypts TOTP secrets; each one is bound to its user's ID.
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>,
  ) {
    this.box = new SecretBox(
      config.get('MFA_ENCRYPTION_KEY', { infer: true }),
      'staff mfa secrets',
    );
  }

  // Step 1 of setting up MFA: a new secret for a staff account. Nothing is
  // saved until the app proves it works (confirmSetup).
  async beginSetup(
    email: string,
  ): Promise<{ userId: string; secret: string; uri: string }> {
    const staff = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, role: true },
    });
    if (!staff || staff.role === 'CUSTOMER') {
      throw new Error('No staff account has this email address.');
    }
    const secret = generateTotpSecret();
    return { userId: staff.id, secret, uri: otpauthUri(secret, staff.email) };
  }

  // Step 2: saves the secret only if the app already shows a valid code. It
  // replaces any earlier secret and signs the staff member out everywhere,
  // because a new phone means whoever used the old one must go.
  async confirmSetup(
    userId: string,
    secret: string,
    code: string,
    now = Date.now(),
  ): Promise<boolean> {
    const step = verifyTotp(secret, code, now);
    if (step === null) {
      return false;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          mfaSecret: this.box.seal(secret, userId),
          mfaEnabledAt: new Date(now),
          // The code just typed must not also work for signing in.
          mfaLastUsedStep: step,
        },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(now) },
      });
      await this.audit.record(tx, {
        action: 'staff.mfa_set_up',
        targetType: 'user',
        targetId: userId,
        after: { mfaEnabled: true },
      });
    });
    return true;
  }

  // For staff login (part 3B-3): checks a code and uses it up. False for a
  // wrong or already used code, or when MFA is not set up.
  async verifyAndUse(
    userId: string,
    code: string,
    now = Date.now(),
  ): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaLastUsedStep: true },
    });
    if (!user?.mfaSecret) {
      return false;
    }
    const secret = this.box.open(user.mfaSecret, userId);
    const step = verifyTotp(secret, code, now, user.mfaLastUsedStep);
    if (step === null) {
      return false;
    }
    // Atomic: if two requests send the same code, only one can use it.
    const claimed = await this.prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: step } }],
      },
      data: { mfaLastUsedStep: step },
    });
    return claimed.count === 1;
  }
}
