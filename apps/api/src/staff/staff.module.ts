import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { AdminInvitationService } from './admin-invitation.service';
import { StaffAdminsController } from './staff-admins.controller';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';
import { StaffMeController } from './staff-me.controller';
import { StaffMfaService } from './staff-mfa.service';

// The staff API: sign-in with MFA, the staff member's own account, and
// inviting Admins.
// SuperUserService is deliberately not here: Super Users are created only
// with the developer command (ADR 0012).
@Module({
  imports: [AuthModule, MailModule],
  controllers: [
    StaffAuthController,
    StaffMeController,
    StaffAdminsController,
  ],
  providers: [StaffAuthService, StaffMfaService, AdminInvitationService],
})
export class StaffModule {}
