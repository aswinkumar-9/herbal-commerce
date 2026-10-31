import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { AuditContext } from '../audit/audit-context';
import { CurrentAuditContext } from '../audit/audit-context.decorator';
import { SuperUserOnly } from '../auth/super-user-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { AdminInvitationService } from './admin-invitation.service';
import { AdminsService } from './admins.service';
import { adminInviteSchema, adminStatusSchema } from './staff.schemas';
import type { AdminInviteInput, AdminStatusInput } from './staff.schemas';

// Admin accounts. Only Super Users may manage them (ADR 0004), and every
// change is written to the audit log.
@SuperUserOnly()
@Controller('staff/admins')
export class StaffAdminsController {
  constructor(
    private readonly invitations: AdminInvitationService,
    private readonly admins: AdminsService,
  ) {}

  // Every Admin, pending invitations included. Reading changes nothing, so
  // it is not audited.
  @Get()
  list() {
    return this.admins.list();
  }

  // Creates the Admin and emails them a link to choose their own password.
  @RateLimit('staffInvites')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  invite(
    @Body(new ZodValidationPipe(adminInviteSchema)) body: AdminInviteInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.invitations.invite(body, context);
  }

  // Sends a pending Admin a new link; the older ones stop working. It
  // sends an email, so it shares the invitation limit.
  @RateLimit('staffInvites')
  @Post(':id/invitation')
  @HttpCode(HttpStatus.CREATED)
  resendInvitation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.invitations.resend(id, context);
  }

  // Disables or enables an Admin. Disabling also ends their sessions.
  // An ID that is not a UUID gets 400 before any database query.
  @Patch(':id')
  setStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(adminStatusSchema)) body: AdminStatusInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.admins.setStatus(id, body.status, context);
  }

  // Removes a disabled Admin, or one who never accepted the invitation.
  // An active Admin gets 409: disable them first.
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.admins.remove(id, context);
  }
}
