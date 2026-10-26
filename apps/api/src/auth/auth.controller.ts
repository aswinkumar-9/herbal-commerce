import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ClientIp } from '../rate-limit/client-ip.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from './auth.schemas';
import type {
  ForgotPasswordInput,
  LoginInput,
  RefreshTokenInput,
  RegisterInput,
  ResendVerificationInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from './auth.schemas';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { Public } from './public.decorator';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly passwordResets: PasswordResetService,
  ) {}

  @Public()
  @RateLimit('register')
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Public()
  @RateLimit('verifyEmail')
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailInput,
  ) {
    return this.auth.verifyEmail(body.token);
  }

  @Public()
  @RateLimit('resendByIp')
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  resendVerification(
    @Body(new ZodValidationPipe(resendVerificationSchema))
    body: ResendVerificationInput,
  ) {
    return this.auth.resendVerification(body.email);
  }

  @Public()
  @RateLimit('login')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Token responses must never be stored by browsers or proxies.
  @Header('Cache-Control', 'no-store')
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @ClientIp() ip: string,
  ) {
    return this.sessions.login(body, ip);
  }

  @Public()
  @RateLimit('refresh')
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  refresh(
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenInput,
  ) {
    return this.sessions.refresh(body.refreshToken);
  }

  // Public because the access token may already have expired. 204 either way.
  @Public()
  @RateLimit('logout')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenInput,
  ) {
    return this.sessions.logout(body.refreshToken);
  }

  // 202 with the same message, whether or not the email has an account.
  @Public()
  @RateLimit('forgotPassword')
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput,
  ) {
    return this.passwordResets.requestReset(body.email);
  }

  // Public: the customer cannot sign in, which is why they are here.
  @Public()
  @RateLimit('resetPassword')
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput,
    @ClientIp() ip: string,
  ) {
    return this.passwordResets.resetPassword(body, ip);
  }
}
