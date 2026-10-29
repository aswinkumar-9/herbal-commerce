import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';
import { StaffMeController } from './staff-me.controller';
import { StaffMfaService } from './staff-mfa.service';

// The staff API: sign-in with MFA and the staff member's own account.
// SuperUserService is deliberately not here: Super Users are created only
// with the developer command (ADR 0012).
@Module({
  imports: [AuthModule],
  controllers: [StaffAuthController, StaffMeController],
  providers: [StaffAuthService, StaffMfaService],
})
export class StaffModule {}
