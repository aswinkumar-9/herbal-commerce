import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from '../mail/mail.module';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginAttemptsService } from './login-attempts.service';
import { MeController } from './me.controller';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Module({
  // No module-wide JWT options: every rule lives in AccessTokenService.
  imports: [MailModule, JwtModule.register({})],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    PasswordService,
    AccessTokenService,
    LoginAttemptsService,
    SessionService,
    PasswordResetService,
  ],
  // The global guard in AppModule needs these two.
  exports: [AccessTokenService, SessionService],
})
export class AuthModule {}
