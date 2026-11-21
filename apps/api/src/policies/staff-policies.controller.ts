import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { AuditContext } from '../audit/audit-context';
import { CurrentAuditContext } from '../audit/audit-context.decorator';
import { SuperUserOnly } from '../auth/super-user-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  discardQuerySchema,
  publishSchema,
  saveDraftSchema,
  versionParamSchema,
} from './policies.schemas';
import type {
  DiscardQuery,
  PublishInput,
  SaveDraftInput,
} from './policies.schemas';
import { PoliciesService } from './policies.service';

// The website's policy pages for Super Users only (ADR 0040): prepare a
// draft, then publish it. Admins get 403. Every change is written to the
// audit log; reading changes nothing, so it is not audited.
@SuperUserOnly()
@Controller('staff/policies')
export class StaffPoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  // Every page: whether it has a draft, and its newest version.
  @Get()
  list() {
    return this.policies.list();
  }

  // One page, with its draft and the text on the website.
  @Get(':page')
  detail(@Param('page') page: string) {
    return this.policies.detail(page);
  }

  // Saves the draft, on the revision it was written on (409 otherwise).
  @Put(':page/draft')
  saveDraft(
    @Param('page') page: string,
    @Body(new ZodValidationPipe(saveDraftSchema)) body: SaveDraftInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.policies.saveDraft(page, body, context);
  }

  // Throws the draft away: DELETE …/draft?revision=3.
  @Delete(':page/draft')
  discardDraft(
    @Param('page') page: string,
    @Query(new ZodValidationPipe(discardQuerySchema)) query: DiscardQuery,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.policies.discardDraft(page, query, context);
  }

  // Puts the draft on the website as the page's next version.
  @Post(':page/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @Param('page') page: string,
    @Body(new ZodValidationPipe(publishSchema)) body: PublishInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.policies.publish(page, body, context);
  }

  // Every version customers have been shown, newest first.
  @Get(':page/versions')
  versions(@Param('page') page: string) {
    return this.policies.versions(page);
  }

  // One version, with its text.
  @Get(':page/versions/:version')
  version(
    @Param('page') page: string,
    @Param('version', new ZodValidationPipe(versionParamSchema))
    version: number,
  ) {
    return this.policies.version(page, version);
  }
}
