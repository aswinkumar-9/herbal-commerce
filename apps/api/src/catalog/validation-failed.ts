import { BadRequestException } from '@nestjs/common';
import type { ProductIssue } from './product-rules';

// The answer the validation pipe gives (common/zod-validation.pipe.ts), for
// the rules that need the stored record or the database: one entry for each
// refused field.
export function validationFailed(issues: ProductIssue[]): BadRequestException {
  return new BadRequestException({
    message: 'Validation failed',
    errors: issues,
  });
}
