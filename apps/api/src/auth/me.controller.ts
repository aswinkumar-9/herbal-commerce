import {
  Body,
  Controller,
  Get,
  Patch,
  UnauthorizedException,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AuthUser } from './auth-user';
import { updateProfileSchema } from './auth.schemas';
import type { UpdateProfileInput } from './auth.schemas';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';

// The account was deleted after the token was issued.
function existing<T>(profile: T | null): T {
  if (!profile) {
    throw new UnauthorizedException('Invalid or expired access token');
  }
  return profile;
}

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

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
}
