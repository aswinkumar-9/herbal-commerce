import { detailOf, type LineGroup, type PlaceSums } from './sales-detail';

const day = (text: string) => new Date(`${text}T00:00:00.000Z`);
const NONE = {
  soldPacks: 0,
  soldRupees: 0,
  soldGstRupees: 0,
  refundedPacks: 0,
  refundedRupees: 0,
  refundedGstRupees: 0,
};
const ASHWAGANDHA = {
  productId: 'p1',
  topCategoryId: 'c1',
  topCategoryName: 'Wellness',
  subcategoryId: 'c2',
  subcategoryName: 'Immunity',
  brandId: 'b1',
  brandName: 'Himalaya',
};
const NOTHING_RECORDED = {
  topCategoryId: null,
  topCategoryName: null,
  subcategoryId: null,
  subcategoryName: null,
  brandId: null,
  brandName: null,
};
const LINES: LineGroup[] = [
  // Sold 2, one of them refunded; then renamed and sold again.
  {
    ...ASHWAGANDHA,
    productName: 'Ashwagandha Capsules',
    _sum: {
      soldPacks: 2,
      soldRupees: 898,
      soldGstRupees: 43,
      refundedPacks: 1,
      refundedRupees: 449,
      refundedGstRupees: 21,
    },
    _max: { day: day('2026-11-20') },
  },
  {
    ...ASHWAGANDHA,
    productName: 'Ashwagandha Capsules 60',
    _sum: { ...NONE, soldPacks: 1, soldRupees: 449, soldGstRupees: 21 },
    _max: { day: day('2026-11-24') },
  },
  // In a top category, without a brand.
  {
    productId: 'p2',
    productName: 'Tulsi Tea',
    ...NOTHING_RECORDED,
    topCategoryId: 'c3',
    topCategoryName: 'Herbal Teas',
    _sum: { ...NONE, soldPacks: 3, soldRupees: 597, soldGstRupees: 91 },
    _max: { day: day('2026-11-10') },
  },
  // Sold before part 15C, its pack size deleted since: nothing recorded.
  {
    productId: null,
    productName: 'Gone Soap',
    ...NOTHING_RECORDED,
    _sum: { ...NONE, soldPacks: 1, soldRupees: 199, soldGstRupees: 30 },
    _max: { day: day('2026-11-05') },
  },
];
const PREVIOUS_LINES: LineGroup[] = [
  {
    ...ASHWAGANDHA,
    productName: 'Ashwagandha',
    _sum: { ...NONE, soldPacks: 1, soldRupees: 449, soldGstRupees: 21 },
    _max: { day: day('2026-10-20') },
  },
  // Sold only before, in Wellness itself.
  {
    ...ASHWAGANDHA,
    productId: 'p4',
    productName: 'Neem Soap',
    subcategoryId: null,
    subcategoryName: null,
    _sum: { ...NONE, soldPacks: 2, soldRupees: 300, soldGstRupees: 46 },
    _max: { day: day('2026-10-15') },
  },
];
const place = (
  state: string,
  method: PlaceSums['method'],
  grossRupees: number,
  refundRupees: number,
  gstRupees: number,
  deliveryRupees: number,
): PlaceSums => ({
  state,
  method,
  grossRupees,
  refundRupees,
  gstRupees,
  deliveryRupees,
});
const PLACES = [
  place('Karnataka', 'UPI', 900, 0, 100, 49),
  place('Karnataka', 'CARD', 450, 0, 50, 0),
  place('Kerala', null, 0, 428, -21, -49),
];
// Sold only before.
const PREVIOUS_PLACES = [place('Goa', 'UPI', 300, 0, 30, 49)];

const detail = (narrowed = false) =>
  detailOf({
    lines: LINES,
    previousLines: PREVIOUS_LINES,
    places: PLACES,
    previousPlaces: PREVIOUS_PLACES,
    states: [
      { state: 'Karnataka', orders: 3 },
      { state: 'Kerala', orders: 0 },
    ],
    methods: [
      { method: 'UPI', orders: 2 },
      { method: 'CARD', orders: 1 },
      { method: null, orders: 0 },
    ],
    narrowed,
  });

describe('detailOf', () => {
  it('lists every product sold now or before, named and grouped as it last sold, the best now first', () => {
    expect(detail().products).toEqual([
      {
        productId: 'p1',
        name: 'Ashwagandha Capsules 60',
        categoryName: 'Wellness',
        subcategoryName: 'Immunity',
        brandName: 'Himalaya',
        recorded: true,
        soldPacks: 3,
        refundedPacks: 1,
        // 855 and 428 without GST, less 428 refunded.
        grossRupees: 1283,
        refundRupees: 428,
        salesRupees: 855,
        gstRupees: 43,
        previousSalesRupees: 428,
      },
      expect.objectContaining({
        productId: 'p2',
        name: 'Tulsi Tea',
        brandName: null,
        recorded: true,
        salesRupees: 506,
        gstRupees: 91,
        previousSalesRupees: 0,
      }),
      expect.objectContaining({
        productId: null,
        name: 'Gone Soap',
        categoryName: null,
        recorded: false,
        salesRupees: 169,
      }),
      // Nothing now: after those that sold.
      expect.objectContaining({
        productId: 'p4',
        name: 'Neem Soap',
        soldPacks: 0,
        salesRupees: 0,
        previousSalesRupees: 254,
      }),
    ]);
  });

  it('counts each category’s products sold now, and keeps its subcategories, and what sold in it directly, under it', () => {
    const { categories, subcategories } = detail();
    expect(
      categories.map((category) => [
        category.name,
        category.products,
        category.salesRupees,
        category.previousSalesRupees,
      ]),
    ).toEqual([
      // Neem Soap sold only before: not one of its products now.
      ['Wellness', 1, 855, 682],
      ['Herbal Teas', 1, 506, 0],
      [null, 1, 169, 0],
    ]);
    expect(
      subcategories.map((subcategory) => [
        subcategory.categoryName,
        subcategory.subcategoryId,
        subcategory.name,
        subcategory.products,
        subcategory.salesRupees,
        subcategory.previousSalesRupees,
      ]),
    ).toEqual([
      ['Wellness', 'c2', 'Immunity', 1, 855, 428],
      ['Wellness', null, null, 0, 0, 254],
      ['Herbal Teas', null, null, 1, 506, 0],
      [null, null, null, 1, 169, 0],
    ]);
  });

  it('tells a product without a brand from an old line with nothing recorded', () => {
    expect(
      detail().brands.map((brand) => [
        brand.brandId,
        brand.name,
        brand.recorded,
        brand.products,
        brand.salesRupees,
        brand.previousSalesRupees,
      ]),
    ).toEqual([
      ['b1', 'Himalaya', true, 1, 855, 682],
      [null, null, true, 1, 506, 0],
      [null, null, false, 1, 169, 0],
    ]);
  });

  it('sums each state and payment method over the other, with its orders, delivery and what was paid', () => {
    const { states, methods } = detail();
    expect(states).toEqual([
      {
        state: 'Karnataka',
        orders: 3,
        grossRupees: 1350,
        refundRupees: 0,
        salesRupees: 1350,
        gstRupees: 150,
        deliveryRupees: 49,
        paidRupees: 1549,
        previousSalesRupees: 0,
      },
      // Sold only before: above one down past nothing.
      expect.objectContaining({
        state: 'Goa',
        orders: 0,
        salesRupees: 0,
        previousSalesRupees: 300,
      }),
      expect.objectContaining({
        state: 'Kerala',
        orders: 0,
        refundRupees: 428,
        salesRupees: -428,
        deliveryRupees: -49,
        paidRupees: -498,
      }),
    ]);
    expect(
      methods.map((method) => [
        method.method,
        method.orders,
        method.salesRupees,
        method.paidRupees,
        method.previousSalesRupees,
      ]),
    ).toEqual([
      ['UPI', 2, 900, 1049, 300],
      ['CARD', 1, 450, 500, 0],
      [null, 0, -428, -498, 0],
    ]);
  });

  it('keeps delivery out when narrowed, as it is charged on a whole order', () => {
    const [karnataka] = detail(true).states;
    expect(karnataka).toMatchObject({
      deliveryRupees: null,
      paidRupees: 1500,
    });
  });

  it('ranks those equal now by the period before, then by name', () => {
    const before = (
      productId: string,
      productName: string,
      rupees: number,
    ) => ({
      ...ASHWAGANDHA,
      productId,
      productName,
      _sum: { ...NONE, soldPacks: 1, soldRupees: rupees },
      _max: { day: day('2026-10-20') },
    });
    const { products } = detailOf({
      lines: [],
      previousLines: [
        before('b', 'Brahmi', 100),
        before('c', 'Chyawanprash', 300),
        before('a', 'Amla', 100),
      ],
      places: [],
      previousPlaces: [],
      states: [],
      methods: [],
      narrowed: false,
    });
    expect(products.map((product) => product.name)).toEqual([
      'Chyawanprash',
      'Amla',
      'Brahmi',
    ]);
  });

  it('keeps a state the report counts orders in, even with nothing summed for it', () => {
    const { states } = detailOf({
      lines: [],
      previousLines: [],
      places: [],
      previousPlaces: [],
      states: [{ state: 'Assam', orders: 2 }],
      methods: [],
      narrowed: false,
    });
    expect(states).toEqual([
      {
        state: 'Assam',
        orders: 2,
        grossRupees: 0,
        refundRupees: 0,
        salesRupees: 0,
        gstRupees: 0,
        deliveryRupees: 0,
        paidRupees: 0,
        previousSalesRupees: 0,
      },
    ]);
  });
});
