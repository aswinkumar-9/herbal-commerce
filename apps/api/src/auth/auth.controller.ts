import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  registerSchema,
  resendVerificationSchema,
  verifyEmailSchema,
} from './auth.schemas';
import type {
  RegisterInput,
  ResendVerificationInput,
  VerifyEmailInput,
} from './auth.schemas';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailInput,
  ) {
    return this.auth.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  resendVerification(
    @Body(new ZodValidationPipe(resendVerificationSchema))
    body: ResendVerificationInput,
  ) {
    return this.auth.resendVerification(body.email);
  }
}
