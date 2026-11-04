import type { ProductType } from '../generated/prisma/enums';

// An FSSAI licence number has exactly 14 digits.
export const FSSAI_LICENCE = /^\d{14}$/;

// The GST rates in percent since GST 2.0 (22 September 2025). When the law
// changes, change this list; a chartered accountant confirms the rate for
// each HSN code (ADR 0022).
export const GST_RATES = [0, 5, 18, 40] as const;

// An HSN code classifies goods for GST: 4, 6 or 8 digits, such as 3004.
export const HSN_CODE = /^(\d{4}|\d{6}|\d{8})$/;

// What a product needs before it may go live: what its page must show
// (ADR 0021), and what its invoices need (ADR 0022). The database's check
// constraint products_live_needs_details_chk holds the same list, as the
// last line of defence.
export const NEEDED_TO_GO_LIVE = [
  'type',
  'licenceNumber',
  'manufacturerName',
  'manufacturerAddress',
  'ingredients',
  'hsnCode',
  'gstRate',
] as const;

// The fields these rules read, as the product will be once saved.
export interface ProductState {
  isActive: boolean;
  type: ProductType | null;
  licenceNumber: string | null;
  manufacturerName: string | null;
  manufacturerAddress: string | null;
  ingredients: string | null;
  hsnCode: string | null;
  gstRate: number | null;
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
  const licence = product.licenceNumber ?? null;
  if (
    product.type === 'FOOD_OR_SUPPLEMENT' &&
    licence !== null &&
    !FSSAI_LICENCE.test(licence)
  ) {
    issues.push({
      field: 'licenceNumber',
      message: 'An FSSAI licence number has exactly 14 digits',
    });
  }
  if (product.isActive) {
    for (const field of NEEDED_TO_GO_LIVE) {
      // Missing counts as empty, so a field left out of a query is never
      // taken as filled in.
      if ((product[field] ?? null) === null) {
        issues.push({ field, message: 'Needed before the product can go live' });
      }
    }
  }
  return issues;
}
