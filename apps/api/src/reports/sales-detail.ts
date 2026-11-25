import type { PaymentMethod } from '../generated/prisma/enums';

// Each grouping in full for the Excel file (part 15D, ADR 0047): what sold
// and what was refunded, in packs and rupees, its GST, and its sales in the
// period before beside them, as a company's sales report lists them. Worked
// out from the daily summaries (ADR 0046), the same rows as the report's.

// A grouping's figures. Rupees are without GST, but for gstRupees.
export interface GroupFigures {
  soldPacks: number;
  refundedPacks: number;
  // What sold, what was refunded of it, and the one less the other: the
  // report's sales.
  grossRupees: number;
  refundRupees: number;
  salesRupees: number;
  // The GST in what sold, less that refunded.
  gstRupees: number;
  // Its sales in the period before.
  previousSalesRupees: number;
}

// The same for a state or a payment method: by its orders.
export interface PlaceFigures {
  orders: number;
  grossRupees: number;
  refundRupees: number;
  salesRupees: number;
  gstRupees: number;
  // None when narrowed: delivery is charged on a whole order.
  deliveryRupees: number | null;
  paidRupees: number;
  previousSalesRupees: number;
}

// Every grouping that sold in the period or the one before: those best
// now first, then those best before.
export interface SalesDetail {
  // Each named, and grouped, as it last sold. Not recorded: an old line,
  // from before part 15C, with nothing but its name.
  products: (GroupFigures & {
    productId: string | null;
    name: string;
    categoryName: string | null;
    subcategoryName: string | null;
    brandName: string | null;
    recorded: boolean;
  })[];
  // With how many products sold in each, in the period.
  categories: (GroupFigures & {
    categoryId: string | null;
    name: string | null;
    products: number;
  })[];
  // Each top category's subcategories, and what sold in it directly (no
  // subcategory), so they add up to it.
  subcategories: (GroupFigures & {
    categoryId: string | null;
    categoryName: string | null;
    subcategoryId: string | null;
    name: string | null;
    products: number;
  })[];
  brands: (GroupFigures & {
    brandId: string | null;
    name: string | null;
    recorded: boolean;
    products: number;
  })[];
  states: (PlaceFigures & { state: string })[];
  // No method: not recorded, for payments made before part 15C.
  methods: (PlaceFigures & { method: PaymentMethod | null })[];
}

type Sums = Partial<
  Record<
    | 'soldPacks'
    | 'soldRupees'
    | 'soldGstRupees'
    | 'refundedPacks'
    | 'refundedRupees'
    | 'refundedGstRupees',
    number | null
  >
>;

// A product's summary rows for a period, as the database groups them.
export interface LineGroup {
  productId: string | null;
  productName: string;
  topCategoryId: string | null;
  topCategoryName: string | null;
  subcategoryId: string | null;
  subcategoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  _sum: Sums;
  _max: { day: Date | null };
}

// A state's and method's orders' rupees for a period, without GST but for
// gstRupees: of every order, or of some products' lines.
export interface PlaceSums {
  state: string;
  method: PaymentMethod | null;
  grossRupees: number;
  refundRupees: number;
  gstRupees: number;
  deliveryRupees: number | null;
}

const zero = (value: number | null | undefined) => value ?? 0;

const noFigures = (): GroupFigures => ({
  soldPacks: 0,
  refundedPacks: 0,
  grossRupees: 0,
  refundRupees: 0,
  salesRupees: 0,
  gstRupees: 0,
  previousSalesRupees: 0,
});

function addLines(figures: GroupFigures, sums: Sums, before: boolean) {
  const gross = zero(sums.soldRupees) - zero(sums.soldGstRupees);
  const refund = zero(sums.refundedRupees) - zero(sums.refundedGstRupees);
  if (before) {
    figures.previousSalesRupees += gross - refund;
    return;
  }
  figures.soldPacks += zero(sums.soldPacks);
  figures.refundedPacks += zero(sums.refundedPacks);
  figures.grossRupees += gross;
  figures.refundRupees += refund;
  figures.salesRupees += gross - refund;
  figures.gstRupees += zero(sums.soldGstRupees) - zero(sums.refundedGstRupees);
}

// A grouping's entries by their keys, each named after its latest row (a
// renamed one shows its newest name: rows before the period are older),
// with the products that sold in it in the period.
class Grouped<T extends GroupFigures> {
  private readonly entries = new Map<
    string,
    { item: T; latest: number; products: Set<string> }
  >();

  constructor(
    private readonly fresh: (row: LineGroup) => T,
    private readonly name: (item: T, row: LineGroup) => void,
  ) {}

  add(key: string, row: LineGroup, product: string, before: boolean) {
    let found = this.entries.get(key);
    if (!found) {
      found = { item: this.fresh(row), latest: -1, products: new Set() };
      this.entries.set(key, found);
    }
    const latest = row._max.day?.getTime() ?? 0;
    if (latest >= found.latest) {
      this.name(found.item, row);
      found.latest = latest;
    }
    addLines(found.item, row._sum, before);
    if (!before && zero(row._sum.soldPacks) > 0) {
      found.products.add(product);
    }
  }

  items(): T[] {
    return [...this.entries.values()].map(({ item }) => item);
  }

  // Each with how many products sold in it.
  all(): (T & { products: number })[] {
    return [...this.entries.values()].map(({ item, products }) => ({
      ...item,
      products: products.size,
    }));
  }
}

// The best now first, then the best before; equal ones by name, those
// without one last.
function ranked<T extends { salesRupees: number; previousSalesRupees: number }>(
  list: T[],
  nameOf: (item: T) => string | null,
): T[] {
  const byName = (a: string | null, b: string | null) =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b);
  return [...list].sort(
    (a, b) =>
      b.salesRupees - a.salesRupees ||
      b.previousSalesRupees - a.previousSalesRupees ||
      byName(nameOf(a), nameOf(b)),
  );
}

function placesOf<K>(
  keyOf: (place: PlaceSums) => K,
  now: PlaceSums[],
  before: PlaceSums[],
  // Each one's orders in the period, as the report counts them.
  orders: Map<K, number>,
  narrowed: boolean,
): (PlaceFigures & { key: K })[] {
  const found = new Map<K, PlaceFigures & { key: K }>();
  const of = (key: K) => {
    const place = found.get(key) ?? {
      key,
      orders: orders.get(key) ?? 0,
      grossRupees: 0,
      refundRupees: 0,
      salesRupees: 0,
      gstRupees: 0,
      deliveryRupees: narrowed ? null : 0,
      paidRupees: 0,
      previousSalesRupees: 0,
    };
    found.set(key, place);
    return place;
  };
  for (const row of now) {
    const place = of(keyOf(row));
    const delivery = narrowed ? 0 : zero(row.deliveryRupees);
    place.grossRupees += row.grossRupees;
    place.refundRupees += row.refundRupees;
    place.salesRupees += row.grossRupees - row.refundRupees;
    place.gstRupees += row.gstRupees;
    if (place.deliveryRupees !== null) {
      place.deliveryRupees += delivery;
    }
    place.paidRupees +=
      row.grossRupees - row.refundRupees + row.gstRupees + delivery;
  }
  for (const row of before) {
    of(keyOf(row)).previousSalesRupees += row.grossRupees - row.refundRupees;
  }
  for (const key of orders.keys()) {
    of(key);
  }
  return [...found.values()];
}

export function detailOf({
  lines,
  previousLines,
  places,
  previousPlaces,
  states,
  methods,
  narrowed,
}: {
  lines: LineGroup[];
  previousLines: LineGroup[];
  places: PlaceSums[];
  previousPlaces: PlaceSums[];
  // The orders of each state and method in the period, as in the report.
  states: { state: string; orders: number }[];
  methods: { method: PaymentMethod | null; orders: number }[];
  narrowed: boolean;
}): SalesDetail {
  type Product = SalesDetail['products'][number];
  type Category = Omit<SalesDetail['categories'][number], 'products'>;
  type Subcategory = Omit<SalesDetail['subcategories'][number], 'products'>;
  type Brand = Omit<SalesDetail['brands'][number], 'products'>;
  const products = new Grouped<Product>(
    (row) => ({
      ...noFigures(),
      productId: row.productId,
      name: row.productName,
      categoryName: null,
      subcategoryName: null,
      brandName: null,
      recorded: false,
    }),
    (item, row) => {
      item.name = row.productName;
      item.categoryName = row.topCategoryName;
      item.subcategoryName = row.subcategoryName;
      item.brandName = row.brandName;
      item.recorded = row.topCategoryId !== null;
    },
  );
  const categories = new Grouped<Category>(
    (row) => ({ ...noFigures(), categoryId: row.topCategoryId, name: null }),
    (item, row) => {
      item.name = row.topCategoryName;
    },
  );
  const subcategories = new Grouped<Subcategory>(
    (row) => ({
      ...noFigures(),
      categoryId: row.topCategoryId,
      categoryName: null,
      subcategoryId: row.subcategoryId,
      name: null,
    }),
    (item, row) => {
      item.categoryName = row.topCategoryName;
      item.name = row.subcategoryName;
    },
  );
  const brands = new Grouped<Brand>(
    (row) => ({
      ...noFigures(),
      brandId: row.brandId,
      name: null,
      // Every line since part 15C has its top category: one without is an
      // old line with nothing recorded, not a product without a brand.
      recorded: row.topCategoryId !== null,
    }),
    (item, row) => {
      item.name = row.brandName;
    },
  );

  for (const [rows, before] of [
    [lines, false],
    [previousLines, true],
  ] as const) {
    for (const row of rows) {
      const product = row.productId ?? `name:${row.productName}`;
      const top = row.topCategoryId ?? 'not recorded';
      products.add(product, row, product, before);
      categories.add(top, row, product, before);
      subcategories.add(
        `${top}\u0000${row.subcategoryId ?? ''}`,
        row,
        product,
        before,
      );
      brands.add(
        row.brandId ??
          (row.topCategoryId !== null ? 'no brand' : 'not recorded'),
        row,
        product,
        before,
      );
    }
  }

  const byName = (item: { name: string | null }) => item.name;
  // A category's subcategories together under it, in its rank.
  const rankedCategories = ranked(categories.all(), byName);
  const rank = new Map(
    rankedCategories.map((category, i) => [category.categoryId, i]),
  );
  const rankedSubcategories = ranked(subcategories.all(), byName).sort(
    (a, b) => (rank.get(a.categoryId) ?? 0) - (rank.get(b.categoryId) ?? 0),
  );

  return {
    products: ranked(products.items(), byName),
    categories: rankedCategories,
    subcategories: rankedSubcategories,
    brands: ranked(brands.all(), byName),
    states: ranked(
      placesOf(
        (place) => place.state,
        places,
        previousPlaces,
        new Map(states.map((state) => [state.state, state.orders])),
        narrowed,
      ).map(({ key, ...place }) => ({ state: key, ...place })),
      (state) => state.state,
    ),
    methods: ranked(
      placesOf(
        (place) => place.method,
        places,
        previousPlaces,
        new Map(methods.map((method) => [method.method, method.orders])),
        narrowed,
      ).map(({ key, ...place }) => ({ method: key, ...place })),
      (method) => method.method,
    ),
  };
}
