import { PACK_UNIT_NAMES } from '../catalog-api';
import type { PackUnit, Variant, VariantFields } from '../catalog-api';

// The pack size dialog's rules: the same as the API's (ADR 0022), so most
// mistakes are caught before anything is sent.

export const SKU_MAX = 40;
// Whole rupees, and whole units on the label, up to 10,00,000.
export const MAX_AMOUNT = 1_000_000;
const SKU_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

// The API's words when a pack size clashes with another of the shop's
// (variants.service.ts), so the console can mark the field that clashed.
export const SKU_TAKEN =
  'Another pack size already has this SKU. Choose a different one.';
export const SIZE_TAKEN = 'This product already has a pack of this size.';

export type PackField =
  'quantity' | 'unit' | 'sku' | 'mrpRupees' | 'priceRupees';
// Top to bottom, as the dialog shows them.
export const PACK_FIELDS: readonly PackField[] = [
  'quantity',
  'unit',
  'sku',
  'mrpRupees',
  'priceRupees',
];
export type PackErrors = Partial<Record<PackField, string>>;

// What staff type, as typed.
export interface PackValues {
  quantity: string;
  unit: PackUnit | '';
  sku: string;
  mrpRupees: string;
  priceRupees: string;
  isActive: boolean;
}

const SINGULAR: Partial<Record<PackUnit, string>> = {
  CAPSULES: 'capsule',
  TABLETS: 'tablet',
  PIECES: 'piece',
};

// How a pack size is named on screen: "100 ml", "60 capsules", "1 tablet".
export function packName({
  quantity,
  unit,
}: Pick<Variant, 'quantity' | 'unit'>): string {
  const name =
    quantity === 1
      ? (SINGULAR[unit] ?? PACK_UNIT_NAMES[unit])
      : PACK_UNIT_NAMES[unit];
  return `${quantity.toLocaleString('en-IN')} ${name}`;
}

// Whole rupees, grouped the Indian way: ₹1,00,000.
export function rupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

// A new pack size starts on sale, as the API's does.
export function startingValues(variant: Variant | null): PackValues {
  return {
    quantity: variant ? String(variant.quantity) : '',
    unit: variant?.unit ?? '',
    sku: variant?.sku ?? '',
    mrpRupees: variant ? String(variant.mrpRupees) : '',
    priceRupees: variant ? String(variant.priceRupees) : '',
    isActive: variant?.isActive ?? true,
  };
}

// A whole number as staff typed it: " 1,000 " and "₹499" count, "499.50"
// does not. null when it is not one.
export function wholeNumber(text: string): number | null {
  const plain = text.replace(/[\s,₹]/g, '');
  return /^\d{1,7}$/.test(plain) ? Number(plain) : null;
}

function amountProblem(
  text: string,
  { empty, unit }: { empty: string; unit: 'rupees' | 'quantity' },
): string | null {
  if (!text.trim()) {
    return empty;
  }
  const value = wholeNumber(text);
  if (value === null) {
    return unit === 'rupees'
      ? 'Whole rupees only, like 499'
      : 'A whole number, like 100';
  }
  if (value < 1 || value > MAX_AMOUNT) {
    return unit === 'rupees'
      ? 'Between ₹1 and ₹10,00,000'
      : 'Between 1 and 10,00,000';
  }
  return null;
}

export function check(values: PackValues): PackErrors {
  const errors: PackErrors = {};
  const quantity = amountProblem(values.quantity, {
    empty: 'Enter the quantity on the label',
    unit: 'quantity',
  });
  if (quantity) {
    errors.quantity = quantity;
  }
  if (!values.unit) {
    errors.unit = 'Choose a unit';
  }
  const sku = values.sku.trim().toUpperCase();
  if (!sku) {
    errors.sku = 'Enter an SKU';
  } else if (sku.length < 3) {
    errors.sku = 'An SKU has at least 3 characters';
  } else if (sku.length > SKU_MAX) {
    errors.sku = `An SKU has at most ${SKU_MAX} characters`;
  } else if (!SKU_PATTERN.test(sku)) {
    errors.sku =
      'An SKU has letters, digits and single hyphens, like "ASH-CAP-60"';
  }
  const mrp = amountProblem(values.mrpRupees, {
    empty: 'Enter the MRP printed on the pack',
    unit: 'rupees',
  });
  if (mrp) {
    errors.mrpRupees = mrp;
  }
  const price = amountProblem(values.priceRupees, {
    empty: 'Enter the price customers pay',
    unit: 'rupees',
  });
  if (price) {
    errors.priceRupees = price;
  } else if (
    !mrp &&
    (wholeNumber(values.priceRupees) ?? 0) >
      (wholeNumber(values.mrpRupees) ?? 0)
  ) {
    errors.priceRupees = 'The price may not be more than the MRP';
  }
  return errors;
}

// What a checked form sends for a new pack size.
export function toFields(values: PackValues): VariantFields {
  return {
    sku: values.sku.trim().toUpperCase(),
    quantity: wholeNumber(values.quantity) ?? 0,
    unit: values.unit as PackUnit,
    mrpRupees: wholeNumber(values.mrpRupees) ?? 0,
    priceRupees: wholeNumber(values.priceRupees) ?? 0,
    isActive: values.isActive,
  };
}

// What a change sends: only the fields that changed.
export function changes(
  values: PackValues,
  variant: Variant,
): Partial<VariantFields> {
  const fields = toFields(values);
  const changed: Partial<VariantFields> = {};
  for (const key of Object.keys(fields) as (keyof VariantFields)[]) {
    if (fields[key] !== variant[key]) {
      Object.assign(changed, { [key]: fields[key] });
    }
  }
  return changed;
}

// The price against the MRP, as staff type them: "₹30 off the MRP".
export function priceHint(values: PackValues): string {
  const mrp = wholeNumber(values.mrpRupees);
  const price = wholeNumber(values.priceRupees);
  if (mrp === null || price === null || price > mrp) {
    return 'What customers pay: at most the MRP.';
  }
  return price === mrp
    ? 'The same as the MRP.'
    : `${rupees(mrp - price)} off the MRP.`;
}
