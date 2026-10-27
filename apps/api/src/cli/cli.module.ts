import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { PasswordService } from '../auth/password.service';
import { validateEnv } from '../config/env';
import { PrismaModule } from '../prisma/prisma.module';
import { SuperUserService } from '../staff/super-user.service';

// Only what the developer commands need: configuration, the database, the
// audit log and password hashing. No HTTP server, no Valkey, no timers.
// SuperUserService is provided here and nowhere else (ADR 0004).
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    PrismaModule,
    AuditModule,
  ],
  providers: [PasswordService, SuperUserService],
})
export class CliModule {}
