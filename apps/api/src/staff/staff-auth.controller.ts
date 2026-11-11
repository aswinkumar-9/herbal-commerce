import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuditContext } from '../audit/audit-context';
import { CurrentAuditContext } from '../audit/audit-context.decorator';
import { refreshTokenSchema } from '../auth/auth.schemas';
import { Public } from '../auth/public.decorator';
import { SessionService } from '../auth/session.service';
import { StaffOnly } from '../auth/staff-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ClientIp } from '../rate-limit/client-ip.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { AdminInvitationService } from './admin-invitation.service';
import { StaffAuthService } from './staff-auth.service';
import { StaffBrowserSession } from './staff-browser-session';
import { acceptInviteSchema, staffLoginSchema } from './staff.schemas';
import type { AcceptInviteInput, StaffLoginInput } from './staff.schemas';

const refreshTokenBody = new ZodValidationPipe(refreshTokenSchema);

// The staff sign-in path. Separate from the customer one: it asks for an
// authenticator code too, and its tokens open only staff routes. The admin
// console keeps its refresh token in a cookie; any other client in the
// body (ADR 0031).
@StaffOnly()
@Controller('staff/auth')
export class StaffAuthController {
  constructor(
    private readonly staffAuth: StaffAuthService,
    private readonly sessions: SessionService,
    private readonly invitations: AdminInvitationService,
    private readonly browser: StaffBrowserSession,
  ) {}

  @Public()
  @RateLimit('staffLogin')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Token responses must never be stored by browsers or proxies.
  @Header('Cache-Control', 'no-store')
  async login(
    @Body(new ZodValidationPipe(staffLoginSchema)) body: StaffLoginInput,
    @ClientIp() ip: string,
    @CurrentAuditContext() context: AuditContext,
    @Headers('origin') origin: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const tokens = await this.staffAuth.login(body, ip, context);
    return this.browser.fromConsole(origin)
      ? this.browser.answer(tokens, response)
      : tokens;
  }

  // From the console, the cookie's token is swapped, and a refused one is
  // forgotten. From anything else, the body's, as before.
  @Public()
  @RateLimit('refresh')
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async refresh(
    @Body() body: unknown,
    @Headers('origin') origin: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!this.browser.fromConsole(origin)) {
      const { refreshToken } = refreshTokenBody.transform(body);
      return this.sessions.refresh(refreshToken, 'staff');
    }
    try {
      const tokens = await this.sessions.refresh(
        this.browser.token(cookie),
        'staff',
      );
      return this.browser.answer(tokens, response);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.browser.clear(response);
      }
      throw error;
    }
  }

  // Public because the access token may already have expired. 204 either
  // way, and the console's cookie is forgotten.
  @Public()
  @RateLimit('logout')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() body: unknown,
    @Headers('origin') origin: string | undefined,
    @Headers('cookie') cookie: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    if (!this.browser.fromConsole(origin)) {
      const { refreshToken } = refreshTokenBody.transform(body);
      return this.sessions.logout(refreshToken, 'staff');
    }
    const token = this.browser.tokenIfAny(cookie);
    if (token) {
      await this.sessions.logout(token, 'staff');
    }
    this.browser.clear(response);
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
