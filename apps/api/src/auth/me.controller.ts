import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ClientIp } from '../rate-limit/client-ip.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import type { AuthUser } from './auth-user';
import { changePasswordSchema, updateProfileSchema } from './auth.schemas';
import type { ChangePasswordInput, UpdateProfileInput } from './auth.schemas';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { PasswordChangeService } from './password-change.service';
import { SessionService } from './session.service';

// The account was deleted after the token was issued.
function existing<T>(profile: T | null): T {
  if (!profile) {
    throw new UnauthorizedException('Invalid or expired access token');
  }
  return profile;
}

@Controller('me')
export class MeController {
  constructor(
    private readonly auth: AuthService,
    private readonly passwordChange: PasswordChangeService,
    private readonly sessions: SessionService,
  ) {}

  // The caller's own account. The ID comes from the token, never from the URL.
  @Get()
  async me(@CurrentUser() user: AuthUser) {
    return existing(await this.auth.getProfile(user.id));
  }

  // Changes the caller's own name. Like reading, it can only ever touch the
  // account in the token.
  @Patch()
  async update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
  ) {
    return existing(await this.auth.updateProfile(user.id, body));
  }

  // Changes the caller's own password, with the current one as proof. Every
  // session ends, so the caller signs in again with the new password.
  @RateLimit('changePassword')
  @Post('password')
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: ChangePasswordInput,
    @ClientIp() ip: string,
  ) {
    return this.passwordChange.change(user.id, body, ip);
  }

  // Signs the caller out on every device, this one too. Their tokens stop
  // working at once; each device signs in again.
  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  signOutEverywhere(@CurrentUser() user: AuthUser) {
    return this.sessions.endAll(user.id);
  }
}
