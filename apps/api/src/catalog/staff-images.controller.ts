import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { uploadedImage } from './image-upload';
import { imageUpdateSchema } from './images.schemas';
import type { ImageUpdateInput } from './images.schemas';
import { ImagesService } from './images.service';

// Product images, for staff (ADR 0023). Admins and Super Users may add,
// change and delete them: unlike other deletions in the catalog, deleting
// an image is not for Super Users only. Every change is written to the
// audit log.
@StaffOnly()
@Controller('staff')
export class StaffImagesController {
  constructor(private readonly images: ImagesService) {}

  // Every image of a product, the main photo first, with the addresses of
  // its two files. Reading is not audited.
  @Get('products/:productId/images')
  list(@Param('productId', new ParseUUIDPipe()) productId: string) {
    return this.images.listForProduct(productId);
  }

  // Adds one image. The request body is the image itself, a JPEG, PNG or
  // WebP of at most 10 MB, with its Content-Type (ImageUploadParser).
  @Post('products/:productId/images')
  @RateLimit('imageUploads')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() body: unknown,
    @Headers('content-type') contentType: string | undefined,
    @CurrentAuditContext() context: AuditContext,
  ) {
    const { file, type } = uploadedImage(body, contentType);
    return this.images.create(productId, file, type, context);
  }

  // Changes an image's description (altText) or its place (position).
  @Patch('images/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(imageUpdateSchema)) body: ImageUpdateInput,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.images.update(id, body, context);
  }

  // Deletes an image for good, with its files. A live product keeps at
  // least one image: deleting its last one answers 409.
  @Delete('images/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAuditContext() context: AuditContext,
  ) {
    return this.images.remove(id, context);
  }
}
