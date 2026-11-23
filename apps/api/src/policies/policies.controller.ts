import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PoliciesService } from './policies.service';

// The website's policy pages as customers see them (ADR 0040): privacy,
// terms, refunds, shipping and contact.
@Controller('policies')
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  // A page's newest published version. Anyone may read it, signed in or
  // not. An unknown page, or one never published, answers 404.
  @Public()
  @Get(':page')
  published(@Param('page') page: string) {
    return this.policies.published(page);
  }
}
