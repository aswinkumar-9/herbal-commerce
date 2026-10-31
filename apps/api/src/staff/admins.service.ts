import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { AuditContext } from '../audit/audit-context';
import { AuditService } from '../audit/audit.service';
import type { Prisma, UserStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const ADMIN_NOT_FOUND = 'Admin not found';
export const DISABLE_FIRST = 'Disable this Admin before removing them.';

// What a Super User sees about each Admin. Never the password hash or the
// MFA secret.
export interface AdminSummary {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
  // When the Admin chose their password with the invitation; null while the
  // invitation is still pending.
  invitationAcceptedAt: Date | null;
  // When the newest unused invitation ends, or null if there is none.
  invitationExpiresAt: Date | null;
  mfaEnabledAt: Date | null;
  createdAt: Date;
}

const ADMIN_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  status: true,
  // An Admin's email is verified when they accept the invitation.
  emailVerifiedAt: true,
  mfaEnabledAt: true,
  createdAt: true,
  staffInvitations: {
    where: { usedAt: null },
    orderBy: { expiresAt: 'desc' },
    take: 1,
    select: { expiresAt: true },
  },
} satisfies Prisma.UserSelect;

type StoredAdmin = Omit<
  AdminSummary,
  'invitationAcceptedAt' | 'invitationExpiresAt'
> & {
  emailVerifiedAt: Date | null;
  staffInvitations: { expiresAt: Date }[];
};

function toSummary({
  emailVerifiedAt,
  staffInvitations,
  ...admin
}: StoredAdmin): AdminSummary {
  return {
    ...admin,
    invitationAcceptedAt: emailVerifiedAt,
    invitationExpiresAt: staffInvitations[0]?.expiresAt ?? null,
  };
}

// Super Users manage Admins (ADR 0004, ADR 0016). Every route that calls
// this service is @SuperUserOnly().
@Injectable()
export class AdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(AdminsService.name)
    private readonly logger: PinoLogger,
  ) {}

  // All Admins, oldest first. There are only a few, so there is no paging.
  async list(): Promise<{ admins: AdminSummary[] }> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: ADMIN_FIELDS,
    });
    return { admins: admins.map(toSummary) };
  }

  // Disables or enables an Admin. Asking for the status the Admin already
  // has changes nothing and is not audited.
  async setStatus(
    id: string,
    status: UserStatus,
    context: AuditContext,
  ): Promise<AdminSummary> {
    const now = new Date();
    const changed = await this.prisma.$transaction(async (tx) => {
      // Atomic: of two requests at the same moment, only one changes it.
      // Only Admins: a Super User's ID is answered like an unknown one.
      const update = await tx.user.updateMany({
        where: { id, role: 'ADMIN', status: { not: status } },
        data: { status },
      });
      if (update.count === 0) {
        return false;
      }
      if (status === 'DISABLED') {
        // A disabled Admin is refused at once anyway, but their sessions
        // must also end, or enabling them later would bring those back.
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      await this.audit.record(tx, {
        ...context,
        action: status === 'DISABLED' ? 'admin.disabled' : 'admin.enabled',
        targetType: 'user',
        targetId: id,
        before: { status: status === 'DISABLED' ? 'ACTIVE' : 'DISABLED' },
        after: { status },
      });
      return true;
    });

    const admin = await this.prisma.user.findFirst({
      where: { id, role: 'ADMIN' },
      select: ADMIN_FIELDS,
    });
    if (!admin) {
      throw new NotFoundException(ADMIN_NOT_FOUND);
    }
    if (changed) {
      this.logger.info(
        { userId: id, actorId: context.actorId, status },
        'Admin status changed',
      );
    }
    return toSummary(admin);
  }

  // Deletes an Admin with their sessions and invitations. The audit log
  // keeps who it was, because its entries have no foreign keys (ADR 0012).
  async remove(id: string, context: AuditContext): Promise<void> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const admin = await tx.user.findFirst({
        where: { id, role: 'ADMIN' },
        select: {
          email: true,
          fullName: true,
          status: true,
          emailVerifiedAt: true,
          mfaEnabledAt: true,
        },
      });
      if (!admin) {
        return 'not_found';
      }
      // Only a disabled Admin, or one who never accepted the invitation, so
      // one wrong click cannot remove someone who can still sign in. The
      // condition is part of the delete, so it holds even if someone
      // enables the Admin at the same moment.
      const deleted = await tx.user.deleteMany({
        where: {
          id,
          role: 'ADMIN',
          OR: [{ status: 'DISABLED' }, { emailVerifiedAt: null }],
        },
      });
      if (deleted.count === 0) {
        // Still active, unless someone removed them at the same moment.
        const stillThere = await tx.user.count({
          where: { id, role: 'ADMIN' },
        });
        return stillThere > 0 ? 'still_active' : 'not_found';
      }
      const { emailVerifiedAt, ...removed } = admin;
      await this.audit.record(tx, {
        ...context,
        action: 'admin.removed',
        targetType: 'user',
        targetId: id,
        before: { ...removed, invitationAcceptedAt: emailVerifiedAt },
      });
      return 'removed';
    });

    if (outcome === 'not_found') {
      throw new NotFoundException(ADMIN_NOT_FOUND);
    }
    if (outcome === 'still_active') {
      throw new ConflictException(DISABLE_FIRST);
    }
    this.logger.info(
      { userId: id, actorId: context.actorId },
      'Admin removed',
    );
  }
}
