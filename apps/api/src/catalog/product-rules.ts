import type { ProductType } from '../generated/prisma/enums';

// An FSSAI licence number has exactly 14 digits.
export const FSSAI_LICENCE = /^\d{14}$/;

// What a product's page must show before it may go live (ADR 0021). The
// database's check constraint products_live_needs_details_chk holds the
// same list, as the last line of defence.
export const NEEDED_TO_GO_LIVE = [
  'type',
  'licenceNumber',
  'manufacturerName',
  'manufacturerAddress',
  'ingredients',
] as const;

// The fields these rules read, as the product will be once saved.
export interface ProductState {
  isActive: boolean;
  type: ProductType | null;
  licenceNumber: string | null;
  manufacturerName: string | null;
  manufacturerAddress: string | null;
  ingredients: string | null;
}

export interface ProductIssue {
  field: string;
  message: string;
}

// What stops a product from being saved like this: an FSSAI licence that is
// not 14 digits, or a live product without its details. Empty when all is
// well. A draft may lack the details, but not have a wrong FSSAI licence.
export function productIssues(product: ProductState): ProductIssue[] {
  const issues: ProductIssue[] = [];
  if (
    product.type === 'FOOD_OR_SUPPLEMENT' &&
    product.licenceNumber !== null &&
    !FSSAI_LICENCE.test(product.licenceNumber)
  ) {
    issues.push({
      field: 'licenceNumber',
      message: 'An FSSAI licence number has exactly 14 digits',
    });
  }
  if (product.isActive) {
    for (const field of NEEDED_TO_GO_LIVE) {
      if (product[field] === null) {
        issues.push({ field, message: 'Needed before the product can go live' });
      }
    }
  }
  return issues;
}
