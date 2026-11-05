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
import { StaffOnly } from '../auth/staff-only.decorator';
import { SuperUserOnly } from '../auth/super-user-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { variantSchema, variantUpdateSchema } from './variants.schemas';
import type { VariantInput, VariantUpdateInput } from './variants.schemas';
import { VariantsService } from './variants.service';

// Pack sizes and their prices, for staff (ADR 0022). Admins and Super Users
// may add and change them; only Super Users may delete them. Every change,
// a new price included, is written to the audit log.
@StaffOnly()
@Controller('staff')
export class StaffVariantsController {
  constructor(private readonly variants: VariantsService) {}

  // Every pack size of a product, off sale ones too. Reading is not
  // audited. An ID that is not a UUID gets 400 before any query.
  @Get('products/:productId/variants')
  list(@Param('productId', new ParseUUIDPipe()) productId: string) {
    return this.variants.listForProduct(productId);
  }

  // A new pack size is on sale unless isActive is false. It shows in the
  // shop once its product is live.
  @Post('products/:productId/variants')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body(new ZodValidationPipe(variantSchema)) body: VariantInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.variants.create(productId, body, context);
  }

  // Changes a pack size: its prices, its SKU, its size, or whether it is
  // on sale.
  @Patch('variants/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(variantUpdateSchema)) body: VariantUpdateInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.variants.update(id, body, context);
  }

  // Deletes a pack size for good. Admins get 403: they take it off sale
  // instead.
  @SuperUserOnly()
  @Delete('variants/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.variants.remove(id, context);
  }
}
