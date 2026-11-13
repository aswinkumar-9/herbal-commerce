import { GST_RATES, PRODUCT_TYPES } from '../catalog-api';
import type { Product, ProductFields, ProductType } from '../catalog-api';
import { SLUG_PATTERN, slugify } from '../slug';

// The product page's form: what staff type, the checks the API makes
// (ADR 0021, 0022), and what is sent. The same rules as the API, so most
// mistakes show before anything is sent.

export const LIMITS = {
  name: 100,
  summary: 160,
  description: 5000,
  usage: 2000,
  licenceNumber: 50,
  manufacturerName: 200,
  manufacturerAddress: 500,
  countryOfOrigin: 60,
  ingredients: 2000,
} as const;

// As the API stores them: " 25d / 123 " is "25D/123", "3004 90" is
// "300490".
export const tidyLicence = (value: string) =>
  value.replace(/\s+/g, '').toUpperCase();
export const tidyHsn = (value: string) => value.replace(/\s+/g, '');

const LICENCE = /^([A-Z0-9][A-Z0-9/.-]*)?$/;
const FSSAI_LICENCE = /^\d{14}$/;
const HSN_CODE = /^(\d{4}|\d{6}|\d{8})$/;

export interface ProductValues {
  categoryId: string;
  name: string;
  slug: string;
  summary: string;
  description: string;
  usage: string;
  type: ProductType | '';
  licenceNumber: string;
  manufacturerName: string;
  manufacturerAddress: string;
  countryOfOrigin: string;
  ingredients: string;
  hsnCode: string;
  // '' or a rate in percent, as the choice's value.
  gstRate: string;
  isActive: boolean;
}

// A field that can be marked wrong. "images" is marked by the switch: a
// live product needs one (ADR 0023).
export type ProductFieldName = Exclude<keyof ProductValues, 'isActive'>;
export type ProductProblem = ProductFieldName | 'images';
export type ProductErrors = Partial<Record<ProductProblem, string>>;

// In the order the page shows them, so the first one marked takes the
// focus.
export const FIELD_ORDER: ProductProblem[] = [
  'name',
  'categoryId',
  'slug',
  'summary',
  'description',
  'usage',
  'type',
  'licenceNumber',
  'manufacturerName',
  'manufacturerAddress',
  'countryOfOrigin',
  'ingredients',
  'hsnCode',
  'gstRate',
  'images',
];

// What a product needs before it can go live, besides an image, with the
// names the page gives them.
export const NEEDED_TO_GO_LIVE = [
  ['type', 'Type'],
  ['licenceNumber', 'Licence number'],
  ['manufacturerName', 'Manufacturer'],
  ['manufacturerAddress', "Manufacturer's address"],
  ['ingredients', 'Ingredients'],
  ['hsnCode', 'HSN code'],
  ['gstRate', 'GST rate'],
] as const;
type NeededField = (typeof NEEDED_TO_GO_LIVE)[number][0];

export const NEEDED_MESSAGE = 'Needed before the product can go live';

// The names of the details a product still lacks to go live.
export function missingToGoLive(product: Pick<Product, NeededField>): string[] {
  return NEEDED_TO_GO_LIVE.filter(([field]) => product[field] === null).map(
    ([, label]) => label,
  );
}

export function startingValues(
  product: Product | null,
  categoryId = '',
): ProductValues {
  return {
    categoryId: product?.categoryId ?? categoryId,
    name: product?.name ?? '',
    slug: product?.slug ?? '',
    summary: product?.summary ?? '',
    description: product?.description ?? '',
    usage: product?.usage ?? '',
    type: product?.type ?? '',
    licenceNumber: product?.licenceNumber ?? '',
    manufacturerName: product?.manufacturerName ?? '',
    manufacturerAddress: product?.manufacturerAddress ?? '',
    countryOfOrigin: product?.countryOfOrigin ?? 'India',
    ingredients: product?.ingredients ?? '',
    hsnCode: product?.hsnCode ?? '',
    gstRate:
      product?.gstRate === null || !product ? '' : String(product.gstRate),
    isActive: product?.isActive ?? false,
  };
}

// The values as the API would store them. An empty text is null.
export function toFields(values: ProductValues): ProductFields {
  const text = (value: string) => value.trim() || null;
  const rate = Number(values.gstRate);
  return {
    categoryId: values.categoryId,
    name: values.name.trim(),
    slug: values.slug.trim(),
    summary: text(values.summary),
    description: text(values.description),
    usage: text(values.usage),
    type: (PRODUCT_TYPES as readonly string[]).includes(values.type)
      ? (values.type as ProductType)
      : null,
    licenceNumber: tidyLicence(values.licenceNumber) || null,
    manufacturerName: text(values.manufacturerName),
    manufacturerAddress: text(values.manufacturerAddress),
    countryOfOrigin: values.countryOfOrigin.trim(),
    ingredients: text(values.ingredients),
    hsnCode: tidyHsn(values.hsnCode) || null,
    gstRate:
      values.gstRate !== '' && (GST_RATES as readonly number[]).includes(rate)
        ? rate
        : null,
    isActive: values.isActive,
  };
}

// The checks the API makes, for a new product (null) or a change.
export function check(
  values: ProductValues,
  product: Product | null,
): ProductErrors {
  const errors: ProductErrors = {};
  const fields = toFields(values);
  if (!fields.name) {
    errors.name = 'Enter a name';
  }
  if (!fields.categoryId) {
    errors.categoryId = 'Choose a category';
  }
  if (fields.slug && !SLUG_PATTERN.test(fields.slug)) {
    errors.slug =
      'Use lowercase letters, digits and single hyphens, like "neem-soap"';
  } else if (!fields.slug && product) {
    errors.slug = 'Enter a slug';
  } else if (!fields.slug && fields.name && !slugify(fields.name)) {
    errors.slug = 'The name has no Latin letters or digits: enter a slug';
  }
  const licence = fields.licenceNumber;
  if (licence && !LICENCE.test(licence)) {
    errors.licenceNumber = 'Use letters, digits, "/", "." and "-" only';
  } else if (
    licence &&
    fields.type === 'FOOD_OR_SUPPLEMENT' &&
    !FSSAI_LICENCE.test(licence)
  ) {
    errors.licenceNumber = 'An FSSAI licence number has exactly 14 digits';
  }
  if (fields.countryOfOrigin.length < 2) {
    errors.countryOfOrigin = 'Enter the country of origin';
  }
  if (fields.hsnCode && !HSN_CODE.test(fields.hsnCode)) {
    errors.hsnCode = 'An HSN code has 4, 6 or 8 digits';
  }
  if (fields.isActive) {
    // Only empty ones: a wrong value is already marked as wrong.
    for (const [field] of NEEDED_TO_GO_LIVE) {
      if (fields[field] === null) {
        errors[field] = NEEDED_MESSAGE;
      }
    }
  }
  return errors;
}

// What a new product sends: a draft, so no isActive (ADR 0021). An empty
// slug is left to the API, which makes it from the name.
export function newProduct(values: ProductValues): Partial<ProductFields> {
  const { isActive: _draft, slug, ...fields } = toFields(values);
  return slug ? { ...fields, slug } : fields;
}

// What a change sends: only what staff changed since the page was loaded
// (or last saved), so a change someone else made meanwhile is not undone.
export function changes(
  values: ProductValues,
  initial: ProductValues,
): Partial<ProductFields> {
  const now = toFields(values);
  const before = toFields(initial);
  const changed: Record<string, unknown> = {};
  for (const key of Object.keys(now) as (keyof ProductFields)[]) {
    if (now[key] !== before[key]) {
      changed[key] = now[key];
    }
  }
  return changed as Partial<ProductFields>;
}

// The form once a change is saved: the saved product, except where staff
// typed on while it was being sent.
export function afterSave(
  current: ProductValues,
  sent: ProductValues,
  saved: ProductValues,
): ProductValues {
  const next = { ...saved };
  for (const key of Object.keys(saved) as (keyof ProductValues)[]) {
    if (current[key] !== sent[key]) {
      (next as Record<keyof ProductValues, unknown>)[key] = current[key];
    }
  }
  return next;
}
