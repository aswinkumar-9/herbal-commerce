import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from '../prisma/prisma-errors';
import type { SuperUserInput } from './staff.schemas';

// ADR 0004: at most 3 Super Users. A database trigger enforces it too.
export const MAX_SUPER_USERS = 3;
const EMAIL_TAKEN = 'An account with this email address already exists.';

// Creates Super Users for the developer command only (ADR 0004). It is not
// part of any API module, so no endpoint can ever reach it.
@Injectable()
export class SuperUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async create(input: SuperUserInput): Promise<{ id: string }> {
    // Checked here for a clear message; the database trigger is the backstop.
    const count = await this.prisma.user.count({
      where: { role: 'SUPER_USER' },
    });
    if (count >= MAX_SUPER_USERS) {
      throw new Error(
        `There are already ${MAX_SUPER_USERS} Super Users, the maximum.`,
      );
    }
    // Customers are never turned into staff: a staff account needs its own
    // address.
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new Error(EMAIL_TAKEN);
    }

    const passwordHash = await this.passwords.hash(input.password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            fullName: input.fullName,
            passwordHash,
            role: 'SUPER_USER',
            // Created by a developer who knows the address.
            emailVerifiedAt: new Date(),
          },
          select: { id: true, email: true, fullName: true, role: true },
        });
        // In the same transaction: no Super User without its audit entry.
        await this.audit.record(tx, {
          action: 'super_user.created',
          targetType: 'user',
          targetId: user.id,
          after: { email: user.email, fullName: user.fullName, role: user.role },
        });
        return { id: user.id };
      });
    } catch (error) {
      // Someone created the same email at the same moment.
      if (isUniqueViolation(error)) {
        throw new Error(EMAIL_TAKEN);
      }
      throw error;
    }
  }
}
