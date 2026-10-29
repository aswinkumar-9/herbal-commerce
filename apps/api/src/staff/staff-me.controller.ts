import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { StaffOnly } from '../auth/staff-only.decorator';
import { StaffAuthService } from './staff-auth.service';

@StaffOnly()
@Controller('staff/me')
export class StaffMeController {
  constructor(private readonly staffAuth: StaffAuthService) {}

  // The caller's own account. The ID comes from the token, never from the URL.
  @Get()
  async me(@CurrentUser() user: AuthUser) {
    const profile = await this.staffAuth.getProfile(user.id);
    if (!profile) {
      // The account was deleted after the token was issued.
      throw new UnauthorizedException('Invalid or expired access token');
    }
    return profile;
  }
}
