import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuditContext } from '../audit/audit-context';
import { CurrentAuditContext } from '../audit/audit-context.decorator';
import { StaffOnly } from '../auth/staff-only.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { StockOverviewService } from './stock-overview.service';
import {
  batchSchema,
  batchUpdateSchema,
  countSchema,
  movementListQuerySchema,
  movementSchema,
  stockListQuerySchema,
} from './stock.schemas';
import type {
  BatchInput,
  BatchUpdateInput,
  CountInput,
  MovementInput,
  MovementListQuery,
  StockListQuery,
} from './stock.schemas';
import { StockService } from './stock.service';

// Stock, batch by batch, for staff (ADR 0024). Admins and Super Users may
// receive batches, correct them and change their stock; nothing here is
// deleted. Every change is a movement, written to the audit log too.
@StaffOnly()
@Controller('staff')
export class StaffStockController {
  constructor(
    private readonly stock: StockService,
    private readonly overview: StockOverviewService,
  ) {}

  // Every pack size with its stock, for the Stock page (ADR 0034).
  @Get('stock')
  list(
    @Query(new ZodValidationPipe(stockListQuerySchema)) query: StockListQuery,
  ) {
    return this.overview.list(query);
  }

  // Every batch of a pack size, the first to expire first, with the packs
  // on hand and those that may be sold. Reading is not audited.
  @Get('variants/:variantId/batches')
  listBatches(@Param('variantId', new ParseUUIDPipe()) variantId: string) {
    return this.stock.listBatches(variantId);
  }

  // Receives a delivery of the pack size: a new batch with its quantity.
  @Post('variants/:variantId/batches')
  @HttpCode(HttpStatus.CREATED)
  receive(
    @Param('variantId', new ParseUUIDPipe()) variantId: string,
    @Body(new ZodValidationPipe(batchSchema)) body: BatchInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.stock.receive(variantId, body, context);
  }

  // Corrects a batch's label details: its number or its dates.
  @Patch('batches/:id')
  updateBatch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(batchUpdateSchema)) body: BatchUpdateInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.stock.updateBatch(id, body, context);
  }

  // A batch's movements, newest first, one page at a time.
  @Get('batches/:id/movements')
  listMovements(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodValidationPipe(movementListQuerySchema))
    query: MovementListQuery,
  ) {
    return this.stock.listMovements(id, query);
  }

  // Changes a batch's stock: more of it received, a write-off, or a
  // correction.
  @Post('batches/:id/movements')
  @HttpCode(HttpStatus.CREATED)
  addMovement(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(movementSchema)) body: MovementInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.stock.addMovement(id, body, context);
  }

  // Puts right a batch's stock from a count of its shelf (ADR 0034).
  @Post('batches/:id/count')
  @HttpCode(HttpStatus.OK)
  count(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(countSchema)) body: CountInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.stock.count(id, body, context);
  }
}
