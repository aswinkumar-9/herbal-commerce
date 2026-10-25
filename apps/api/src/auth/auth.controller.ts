import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resendVerificationSchema,
  verifyEmailSchema,
} from './auth.schemas';
import type {
  LoginInput,
  RefreshTokenInput,
  RegisterInput,
  ResendVerificationInput,
  VerifyEmailInput,
} from './auth.schemas';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailInput,
  ) {
    return this.auth.verifyEmail(body.token);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  resendVerification(
    @Body(new ZodValidationPipe(resendVerificationSchema))
    body: ResendVerificationInput,
  ) {
    return this.auth.resendVerification(body.email);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Token responses must never be stored by browsers or proxies.
  @Header('Cache-Control', 'no-store')
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.sessions.login(body);
  }

  @Public()
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
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(
    @Body(new ZodValidationPipe(refreshTokenSchema)) body: RefreshTokenInput,
  ) {
    return this.sessions.logout(body.refreshToken);
  }
}
