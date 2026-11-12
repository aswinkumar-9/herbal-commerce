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
  Put,
} from '@nestjs/common';
import type { AuditContext } from '../audit/audit-context';
import { CurrentAuditContext } from '../audit/audit-context.decorator';
import { StaffOnly } from '../auth/staff-only.decorator';
import { SuperUserOnly } from '../auth/super-user-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  categoryOrderSchema,
  categorySchema,
  categoryUpdateSchema,
} from './categories.schemas';
import type {
  CategoryInput,
  CategoryOrderInput,
  CategoryUpdateInput,
} from './categories.schemas';
import { CategoriesService } from './categories.service';

// Product categories for staff (ADR 0020). Admins and Super Users may
// create, change, activate and deactivate them; only Super Users may delete
// them. Every change is written to the audit log.
@StaffOnly()
@Controller('staff/categories')
export class StaffCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  // Every category, hidden ones too. Reading changes nothing, so it is not
  // audited.
  @Get()
  list() {
    return this.categories.list();
  }

  // A new category starts hidden from customers unless isActive is sent.
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(categorySchema)) body: CategoryInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.categories.create(body, context);
  }

  // A new order for the categories customers see: all of them, first to
  // last.
  @Put('order')
  reorder(
    @Body(new ZodValidationPipe(categoryOrderSchema)) body: CategoryOrderInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.categories.reorder(body, context);
  }

  // Changes, activates or deactivates a category. An ID that is not a UUID
  // gets 400 before any database query.
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(categoryUpdateSchema)) body: CategoryUpdateInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.categories.update(id, body, context);
  }

  // Deletes a category for good. Admins get 403: they deactivate instead.
  @SuperUserOnly()
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.categories.remove(id, context);
  }
}
