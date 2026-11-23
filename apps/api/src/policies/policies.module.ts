import { Module } from '@nestjs/common';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { StaffPoliciesController } from './staff-policies.controller';

// The website's policy pages (ADR 0040): Super Users write and publish them,
// and anyone reads the published ones.
@Module({
  controllers: [PoliciesController, StaffPoliciesController],
  providers: [PoliciesService],
})
export class PoliciesModule {}
