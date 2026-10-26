import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AccessTokenGuard } from './auth/access-token.guard';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { Env, validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { buildLoggerParams } from './logging/logger.config';
import { PrismaModule } from './prisma/prisma.module';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { ValkeyModule } from './valkey/valkey.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildLoggerParams({
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
        }),
    }),
    PrismaModule,
    ValkeyModule,
    RateLimitModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Global guards run in this order. Rate limits first, so floods are
    // refused before any token or database work.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // Deny by default: every route needs a valid access token unless @Public().
    { provide: APP_GUARD, useClass: AccessTokenGuard },
  ],
})
export class AppModule {}
