import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { hashToken } from '../auth/token.util';
import { Env } from '../config/env';
import type { StaffLinkPurpose } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StaffMfaService } from './staff-mfa.service';

// An emailed link works for 72 hours, and only once: people do not always
// read their email at once.
export const SETUP_LINK_TTL_MS = 72 * 60 * 60 * 1000;

// One answer for every refused link, whatever the reason.
export const INVALID_LINK: Record<StaffLinkPurpose, string> = {
  INVITE: 'Invalid or expired invitation link',
  AUTHENTICATOR_RESET: 'Invalid or expired link',
};

// The console's page for each kind of link (ADMIN_ORIGIN).
const PAGES: Record<StaffLinkPurpose, string> = {
  INVITE: '/accept-invite',
  AUTHENTICATOR_RESET: '/reset-authenticator',
};

type LinkFailure =
  | 'unknown_token'
  | 'wrong_purpose'
  | 'already_used'
  | 'expired'
  | 'not_allowed';

// A link that may still be used, with the key shown for it, if any.
export interface UsableLink {
  id: string;
  userId: string;
  purpose: StaffLinkPurpose;
  expiresAt: Date;
  email: string;
  fullName: string;
  // The key shown when the link was opened, or null if it never was.
  secret: string | null;
}

// What the console shows to whoever opened a link: who it is for, and the
// key to put into the authenticator app, as text and as an otpauth:// address
// for a QR code.
export interface LinkKey {
  purpose: StaffLinkPurpose;
  email: string;
  fullName: string;
  key: string;
  uri: string;
  expiresAt: Date;
}

// The links emailed to Admins (ADR 0015, ADR 0038): an invitation, where the
// Admin chooses a password and sets up the authenticator app together, and a
// new start for the app after a Super User reset it. The token is the only
// proof, so only its hash is stored, and a link works once.
@Injectable()
export class SetupLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: StaffMfaService,
    private readonly config: ConfigService<Env, true>,
    @InjectPinoLogger(SetupLinksService.name)
    private readonly logger: PinoLogger,
  ) {}

  // The address emailed for a token, on the console's own page.
  url(purpose: StaffLinkPurpose, token: string): string {
    const base = this.config.get('ADMIN_ORIGIN', { infer: true });
    return `${base}${PAGES[purpose]}?token=${encodeURIComponent(token)}`;
  }

  // Public: the key for an emailed link, made the first time the link is
  // opened and the same one after that, so a page opened again shows what
  // was already scanned. Nothing else changes until a code confirms it.
  async key(token: string): Promise<LinkKey> {
    const link = await this.usable(token, null);
    let secret = link.secret;
    if (secret === null) {
      const fresh = this.mfa.newKey(link.email).secret;
      // Atomic: of two pages opened at the same moment, one key wins.
      await this.prisma.staffInvitation.updateMany({
        where: { id: link.id, pendingMfaSecret: null },
        data: { pendingMfaSecret: this.mfa.seal(fresh, link.id) },
      });
      const stored = await this.prisma.staffInvitation.findUnique({
        where: { id: link.id },
        select: { pendingMfaSecret: true },
      });
      if (!stored?.pendingMfaSecret) {
        throw this.refused(link.purpose, 'unknown_token', link.userId);
      }
      secret = this.mfa.open(stored.pendingMfaSecret, link.id);
    }
    return {
      purpose: link.purpose,
      email: link.email,
      fullName: link.fullName,
      key: secret,
      uri: this.mfa.keyUri(secret, link.email),
      expiresAt: link.expiresAt,
    };
  }

  // A link that may still be used: known, for this purpose (any, when
  // null), not used, not expired, for an active Admin. Anything else gets
  // one answer, logged with its reason.
  async usable(
    token: string,
    purpose: StaffLinkPurpose | null,
  ): Promise<UsableLink> {
    const link = await this.prisma.staffInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        userId: true,
        purpose: true,
        expiresAt: true,
        usedAt: true,
        pendingMfaSecret: true,
        user: {
          select: {
            role: true,
            status: true,
            email: true,
            fullName: true,
            emailVerifiedAt: true,
          },
        },
      },
    });
    const answerAs = purpose ?? link?.purpose ?? 'INVITE';
    if (!link) {
      throw this.refused(answerAs, 'unknown_token');
    }
    const { userId, user } = link;
    if (purpose !== null && link.purpose !== purpose) {
      throw this.refused(answerAs, 'wrong_purpose', userId);
    }
    if (link.usedAt) {
      throw this.refused(answerAs, 'already_used', userId);
    }
    if (link.expiresAt <= new Date()) {
      throw this.refused(answerAs, 'expired', userId);
    }
    // A disabled Admin stays out, even with a valid link. A new start for
    // the app is only for an Admin who accepted the invitation.
    const allowed =
      user.role === 'ADMIN' &&
      user.status === 'ACTIVE' &&
      (link.purpose === 'INVITE' || user.emailVerifiedAt !== null);
    if (!allowed) {
      throw this.refused(answerAs, 'not_allowed', userId);
    }
    return {
      id: link.id,
      userId,
      purpose: link.purpose,
      expiresAt: link.expiresAt,
      email: user.email,
      fullName: user.fullName,
      secret: link.pendingMfaSecret
        ? this.mfa.open(link.pendingMfaSecret, link.id)
        : null,
    };
  }

  // Logs the reason and builds the one answer every refused link gets.
  refused(
    purpose: StaffLinkPurpose,
    reason: LinkFailure | 'lost_race',
    userId?: string,
  ): BadRequestException {
    this.logger.info({ userId, purpose, reason }, 'Staff link refused');
    return new BadRequestException(INVALID_LINK[purpose]);
  }
}
