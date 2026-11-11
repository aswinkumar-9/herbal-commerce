import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { AdminInvitationService } from './admin-invitation.service';
import { AdminsService } from './admins.service';
import { StaffAdminsController } from './staff-admins.controller';
import { StaffAuditLogController } from './staff-audit-log.controller';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';
import { StaffBrowserSession } from './staff-browser-session';
import { StaffMeController } from './staff-me.controller';
import { StaffMfaService } from './staff-mfa.service';

// The staff API: sign-in with MFA, the staff member's own account, managing
// Admins and reading the audit log.
// SuperUserService is deliberately not here: Super Users are created only
// with the developer command (ADR 0012).
@Module({
  imports: [AuthModule, MailModule],
  controllers: [
    StaffAuthController,
    StaffMeController,
    StaffAdminsController,
    StaffAuditLogController,
  ],
  providers: [
    StaffAuthService,
    StaffBrowserSession,
    StaffMfaService,
    AdminInvitationService,
    AdminsService,
  ],
})
export class StaffModule {}
