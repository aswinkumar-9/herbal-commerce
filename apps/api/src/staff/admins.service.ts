import { Injectable } from '@nestjs/common';
import type { UserStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

// Super Users manage Admins (ADR 0004, ADR 0016). Every route that calls
// this service is @SuperUserOnly().
@Injectable()
export class AdminsService {
  constructor(private readonly prisma: PrismaService) {}

  // All Admins, oldest first. There are only a few, so there is no paging.
  async list(): Promise<{ admins: AdminSummary[] }> {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
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
      },
    });
    return {
      admins: admins.map(({ emailVerifiedAt, staffInvitations, ...admin }) => ({
        ...admin,
        invitationAcceptedAt: emailVerifiedAt,
        invitationExpiresAt: staffInvitations[0]?.expiresAt ?? null,
      })),
    };
  }
}
