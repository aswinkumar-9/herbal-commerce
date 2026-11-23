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
  UseInterceptors,
} from '@nestjs/common';
import type { AuditContext } from '../audit/audit-context';
import { CurrentAuditContext } from '../audit/audit-context.decorator';
import { StaffOnly } from '../auth/staff-only.decorator';
import { SuperUserOnly } from '../auth/super-user-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { brandSchema, brandUpdateSchema } from './brands.schemas';
import type { BrandInput, BrandUpdateInput } from './brands.schemas';
import { BrandsService } from './brands.service';
import { CatalogChanged } from './catalog-changed.interceptor';

// Brands for staff (part 15A). Admins and Super Users may create and rename
// them; only Super Users may delete them. Every change is written to the
// audit log.
@StaffOnly()
@UseInterceptors(CatalogChanged)
@Controller('staff/brands')
export class StaffBrandsController {
  constructor(private readonly brands: BrandsService) {}

  // Every brand, with how many products have it. Reading changes nothing,
  // so it is not audited.
  @Get()
  list() {
    return this.brands.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(brandSchema)) body: BrandInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.brands.create(body, context);
  }

  // Renames a brand, or changes its slug. An ID that is not a UUID gets 400
  // before any database query.
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(brandUpdateSchema)) body: BrandUpdateInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.brands.update(id, body, context);
  }

  // Deletes a brand for good, once no product has it. Admins get 403.
  @SuperUserOnly()
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.brands.remove(id, context);
  }
}
