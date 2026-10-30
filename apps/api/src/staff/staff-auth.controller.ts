import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import type { AuditContext } from '../audit/audit-context';
import { CurrentAuditContext } from '../audit/audit-context.decorator';
import { refreshTokenSchema } from '../auth/auth.schemas';
import type { RefreshTokenInput } from '../auth/auth.schemas';
import { Public } from '../auth/public.decorator';
import { SessionService } from '../auth/session.service';
import { StaffOnly } from '../auth/staff-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ClientIp } from '../rate-limit/client-ip.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { AdminInvitationService } from './admin-invitation.service';
import { StaffAuthService } from './staff-auth.service';
import { acceptInviteSchema, staffLoginSchema } from './staff.schemas';
import type { AcceptInviteInput, StaffLoginInput } from './staff.schemas';

// The staff sign-in path. Separate from the customer one: it asks for an
// authenticator code too, and its tokens open only staff routes.
@StaffOnly()
@Controller('staff/auth')
export class StaffAuthController {
  constructor(
    private readonly staffAuth: StaffAuthService,
    private readonly sessions: SessionService,
    private readonly invitations: AdminInvitationService,
  ) {}

  @Public()
  @RateLimit('staffLogin')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Token responses must never be stored by browsers or proxies.
  @Header('Cache-Control', 'no-store')
  login(
    @Body(new ZodValidationPipe(staffLoginSchema)) body: StaffLoginInput,
    @ClientIp() ip: string,
  ) {
    return this.staffAuth.login(body, ip);
  }

  @Public()
  @RateLimit('refresh')
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  refresh(
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenInput,
  ) {
    return this.sessions.refresh(body.refreshToken, 'staff');
  }

  // Public because the access token may already have expired. 204 either way.
  @Public()
  @RateLimit('logout')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenInput,
  ) {
    return this.sessions.logout(body.refreshToken, 'staff');
  }

  // Public: an invited Admin has no password yet. They choose it here with
  // the token from the invitation email (ADR 0015).
  @Public()
  @RateLimit('acceptInvite')
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  acceptInvite(
    @Body(new ZodValidationPipe(acceptInviteSchema)) body: AcceptInviteInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.invitations.accept(body, context);
  }
}
