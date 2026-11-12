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
  Query,
} from '@nestjs/common';
import type { AuditContext } from '../audit/audit-context';
import { CurrentAuditContext } from '../audit/audit-context.decorator';
import { StaffOnly } from '../auth/staff-only.decorator';
import { SuperUserOnly } from '../auth/super-user-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  productListQuerySchema,
  productOrderSchema,
  productSchema,
  productUpdateSchema,
} from './products.schemas';
import type {
  ProductInput,
  ProductListQuery,
  ProductOrderInput,
  ProductUpdateInput,
} from './products.schemas';
import { ProductsService } from './products.service';

// Products for staff (ADR 0021). Admins and Super Users may create, change,
// activate and deactivate them; only Super Users may delete them. Every
// change is written to the audit log.
@StaffOnly()
@Controller('staff/products')
export class StaffProductsController {
  constructor(private readonly products: ProductsService) {}

  // Every product, drafts too, one page at a time: the nextAfter of one
  // page is the ?after= of the next. With ?q=, the best matches by name, on
  // one page. Reading is not audited.
  @Get()
  list(
    @Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery,
  ) {
    return this.products.list(query);
  }

  // One product, drafts too, for its page in the admin console.
  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.products.findForStaff(id);
  }

  // A new order for a category's products: all of them, first to last.
  @Put('order')
  reorder(
    @Body(new ZodValidationPipe(productOrderSchema)) body: ProductOrderInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.products.reorder(body, context);
  }

  // A new product starts as a hidden draft unless isActive is sent.
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(productSchema)) body: ProductInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.products.create(body, context);
  }

  // Changes a product, moves it to another category, or activates or
  // deactivates it. An ID that is not a UUID gets 400 before any query.
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(productUpdateSchema)) body: ProductUpdateInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.products.update(id, body, context);
  }

  // Deletes a product for good. Admins get 403: they deactivate instead.
  @SuperUserOnly()
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.products.remove(id, context);
  }
}
