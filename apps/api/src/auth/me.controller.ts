import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from './auth-user';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  // The caller's own account. The ID comes from the token, never from the URL.
  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const profile = await this.auth.getProfile(user.id);
    if (!profile) {
      // The account was deleted after the token was issued.
      throw new UnauthorizedException('Invalid or expired access token');
    }
    return profile;
  }
}
