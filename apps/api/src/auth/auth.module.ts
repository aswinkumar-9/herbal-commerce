import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from '../mail/mail.module';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Module({
  // No module-wide JWT options: every rule lives in AccessTokenService.
  imports: [MailModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, AccessTokenService, SessionService],
})
export class AuthModule {}
