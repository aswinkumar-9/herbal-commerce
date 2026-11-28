import { inflateRawSync } from 'node:zlib';
import { Workbook } from 'exceljs';
import type { Worksheet } from 'exceljs';
import type { GroupFigures, SalesDetail } from './sales-detail';
import type {
  RegisterLine,
  SalesDay,
  SalesReport,
  SalesTotals,
} from './sales-report.service';
import {
  safeText,
  salesFileName,
  salesWorkbook,
  XLSX_TYPE,
} from './sales-workbook';

const NONE: SalesTotals = {
  salesRupees: 0,
  gstRupees: 0,
  deliveryRupees: 0,
  paidRupees: 0,
  orders: 0,
  averageOrderRupees: null,
  refundedOrders: 0,
  refundedRupees: 0,
  newCustomers: 0,
  returningCustomers: 0,
};
const TOTALS: SalesTotals = {
  salesRupees: 1374,
  gstRupees: 179,
  deliveryRupees: 49,
  paidRupees: 1602,
  orders: 4,
  averageOrderRupees: 451,
  refundedOrders: 1,
  refundedRupees: 498,
  newCustomers: 2,
  returningCustomers: 1,
};
const REPORT: SalesReport = {
  period: { from: '2026-11-20', to: '2026-11-21' },
  filters: {
    product: null,
    category: null,
    brand: null,
    state: null,
    method: null,
  },
  previousPeriod: { from: '2026-11-18', to: '2026-11-19' },
  refreshedAt: new Date('2026-11-25T06:40:00.000Z'),
  totals: TOTALS,
  previousTotals: { ...NONE, salesRupees: 1000, orders: 2 },
  series: { unit: 'day', points: [] },
  calendar: null,
  products: [],
  categories: [],
  brands: [],
  states: [],
  methods: [],
};
const NARROWED: SalesReport = {
  ...REPORT,
  filters: {
    product: { productId: 'p1', name: 'Ashwagandha Capsules' },
    category: {
      categoryId: 'c2',
      name: 'Immunity',
      parentName: 'Wellness',
    },
    brand: { brandId: 'b9', name: null },
    state: null,
    method: null,
  },
  // More refunded than sold: down past 0 is no share of what it was.
  totals: { ...TOTALS, salesRupees: -428, deliveryRupees: null },
  previousTotals: { ...NONE, salesRupees: 1000, deliveryRupees: null },
};
const day = (text: string, salesRupees: number, orders: number): SalesDay => ({
  day: text,
  salesRupees,
  gstRupees: 10,
  deliveryRupees: 49,
  paidRupees: salesRupees + 59,
  orders,
  refundedOrders: 0,
  refundedRupees: 0,
});
const DAYS = [day('2026-11-20', 1802, 4), day('2026-11-21', -428, 0)];

// Packs sold and refunded, gross sales, refunds, GST and the period
// before's sales.
const figures = (
  soldPacks: number,
  refundedPacks: number,
  grossRupees: number,
  refundRupees: number,
  gstRupees: number,
  previousSalesRupees: number,
): GroupFigures => ({
  soldPacks,
  refundedPacks,
  grossRupees,
  refundRupees,
  salesRupees: grossRupees - refundRupees,
  gstRupees,
  previousSalesRupees,
});
const DETAIL: SalesDetail = {
  products: [
    {
      productId: 'p1',
      name: 'Ashwagandha Capsules',
      categoryName: 'Wellness',
      subcategoryName: 'Immunity',
      brandName: 'Himalaya',
      recorded: true,
      ...figures(3, 1, 1284, 428, 43, 1000),
    },
    {
      productId: 'p2',
      name: 'Tulsi Tea',
      categoryName: 'Herbal Teas',
      subcategoryName: null,
      brandName: null,
      recorded: true,
      ...figures(2, 0, 344, 0, 52, 0),
    },
    {
      productId: null,
      name: '=HYPERLINK("x")',
      categoryName: null,
      subcategoryName: null,
      brandName: null,
      recorded: false,
      ...figures(1, 0, 174, 0, 30, 200),
    },
    // Sold only before.
    {
      productId: 'p4',
      name: 'Neem Soap',
      categoryName: 'Wellness',
      subcategoryName: null,
      brandName: 'Himalaya',
      recorded: true,
      ...figures(0, 0, 0, 0, 0, 300),
    },
  ],
  categories: [
    {
      categoryId: 'c1',
      name: 'Wellness',
      products: 1,
      ...figures(3, 1, 1284, 428, 43, 1300),
    },
    {
      categoryId: 'c3',
      name: 'Herbal Teas',
      products: 1,
      ...figures(2, 0, 344, 0, 52, 0),
    },
    {
      categoryId: null,
      name: null,
      products: 1,
      ...figures(1, 0, 174, 0, 30, 200),
    },
  ],
  subcategories: [
    {
      categoryId: 'c1',
      categoryName: 'Wellness',
      subcategoryId: 'c2',
      name: 'Immunity',
      products: 1,
      ...figures(3, 1, 1284, 428, 43, 1000),
    },
    {
      categoryId: 'c1',
      categoryName: 'Wellness',
      subcategoryId: null,
      name: null,
      products: 0,
      ...figures(0, 0, 0, 0, 0, 300),
    },
    {
      categoryId: null,
      categoryName: null,
      subcategoryId: null,
      name: null,
      products: 1,
      ...figures(1, 0, 174, 0, 30, 200),
    },
  ],
  brands: [
    {
      brandId: 'b1',
      name: 'Himalaya',
      recorded: true,
      products: 1,
      ...figures(3, 1, 1284, 428, 43, 1300),
    },
    {
      brandId: null,
      name: null,
      recorded: true,
      products: 1,
      ...figures(2, 0, 344, 0, 52, 0),
    },
    {
      brandId: null,
      name: null,
      recorded: false,
      products: 1,
      ...figures(1, 0, 174, 0, 30, 200),
    },
  ],
  states: [
    {
      state: 'Karnataka',
      orders: 4,
      grossRupees: 1802,
      refundRupees: 428,
      salesRupees: 1374,
      gstRupees: 125,
      deliveryRupees: 49,
      paidRupees: 1548,
      previousSalesRupees: 1000,
    },
  ],
  methods: [
    {
      method: 'NETBANKING',
      orders: 4,
      grossRupees: 1802,
      refundRupees: 0,
      salesRupees: 1802,
      gstRupees: 146,
      deliveryRupees: 98,
      paidRupees: 2046,
      previousSalesRupees: 1000,
    },
    {
      method: null,
      orders: 0,
      grossRupees: 0,
      refundRupees: 428,
      salesRupees: -428,
      gstRupees: -21,
      deliveryRupees: -49,
      paidRupees: -498,
      previousSalesRupees: 0,
    },
  ],
};
const NO_DETAIL: SalesDetail = {
  products: [],
  categories: [],
  subcategories: [],
  brands: [],
  states: [],
  methods: [],
};

const SOLD: RegisterLine = {
  at: '2026-11-20 00:00:00',
  kind: 'SALE',
  reference: 'BBBBBBBBBB',
  state: 'Kerala',
  method: 'CARD',
  product: {
    name: 'Ashwagandha Capsules',
    sku: 'ASH-60',
    categoryName: 'Wellness',
    subcategoryName: 'Immunity',
    brandName: 'Himalaya',
    gstRate: 5,
  },
  packs: 1,
  priceRupees: 428,
  gstRupees: 21,
  totalRupees: 449,
};
const REGISTER: RegisterLine[] = [
  SOLD,
  {
    ...SOLD,
    product: null,
    packs: 0,
    priceRupees: 49,
    gstRupees: 0,
    totalRupees: 49,
  },
  {
    ...SOLD,
    at: '2026-11-21 00:30:00',
    kind: 'REFUND',
    packs: -1,
    priceRupees: -428,
    gstRupees: -21,
    totalRupees: -449,
  },
  {
    ...SOLD,
    at: '2026-11-21 00:30:00',
    kind: 'REFUND',
    product: null,
    packs: 0,
    priceRupees: -49,
    gstRupees: 0,
    totalRupees: -49,
  },
  // The same pack size, renamed since.
  {
    ...SOLD,
    at: '2026-11-21 09:00:00',
    reference: 'CCCCCCCCCC',
    product: { ...SOLD.product!, name: 'Ashwagandha Capsules 60' },
    packs: 2,
    priceRupees: 856,
    gstRupees: 42,
    totalRupees: 898,
  },
  {
    ...SOLD,
    at: '2026-11-21 10:00:00',
    reference: 'DDDDDDDDDD',
    product: {
      name: 'Tulsi Tea',
      sku: 'TUL-100',
      categoryName: 'Herbal Teas',
      subcategoryName: null,
      brandName: null,
      gstRate: 5,
    },
    packs: 1,
    priceRupees: 172,
    gstRupees: 9,
    totalRupees: 181,
  },
];

interface Made {
  report?: SalesReport;
  days?: SalesDay[];
  detail?: SalesDetail;
  register?: RegisterLine[];
}
const made = ({
  report = REPORT,
  days = DAYS,
  detail = DETAIL,
  register = REGISTER,
}: Made = {}) =>
  salesWorkbook({
    report,
    days,
    detail,
    register,
    preparedAt: new Date('2026-11-25T10:20:00.000Z'),
    preparedBy: 'Ravi Kumar',
  });

async function opened(input: Made = {}) {
  const file = await made(input);
  const book = new Workbook();
  await book.xlsx.load(file as unknown as ArrayBuffer);
  return book;
}

// One file of the zip an .xlsx is, as text, found in its central
// directory.
function zipped(file: Buffer, name: string): string {
  for (let at = 0; at < file.length - 46; at += 1) {
    if (
      file.readUInt32LE(at) === 0x02014b50 &&
      file.toString('utf8', at + 46, at + 46 + file.readUInt16LE(at + 28)) ===
        name
    ) {
      const method = file.readUInt16LE(at + 10);
      const size = file.readUInt32LE(at + 20);
      const local = file.readUInt32LE(at + 42);
      const start =
        local +
        30 +
        file.readUInt16LE(local + 26) +
        file.readUInt16LE(local + 28);
      const data = file.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
  }
  throw new Error(`${name} is not in the file`);
}

// A sheet's rows as plain values, a formula as its result: exceljs keeps
// no result of 0, which Excel works out as the file opens.
function rows(sheet: Worksheet | undefined): unknown[][] {
  const found: unknown[][] = [];
  sheet?.eachRow({ includeEmpty: true }, (row) => {
    const values = (row.values as unknown[])
      .slice(1)
      .map((value) =>
        value !== null && typeof value === 'object' && 'formula' in value
          ? ((value as { result?: unknown }).result ?? 0)
          : value,
      );
    found.push(values);
  });
  return found;
}

const TITLES = [
  '20 Nov 2026 to 21 Nov 2026, compared with 18 Nov 2026 to 19 Nov 2026 · All sales',
  'Amounts in rupees, without GST unless a column says so. Filter or sort with the buttons on the header row: the Total row adds up the rows shown.',
];

describe('salesWorkbook', () => {
  it('makes an Excel file of sheets a company reads: a dashboard, a summary, each day, each grouping and the register', async () => {
    const book = await opened();
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
      'Dashboard',
      'Summary',
      'Sales by day',
      'Products',
      'Pack sizes',
      'Categories',
      'Subcategories',
      'Brands',
      'States',
      'Payment methods',
      'Sales register',
    ]);
    expect(book.creator).toBe('Herbal Commerce');
    const file = await made();
    // Excel works every total out again as it opens the file.
    const workbook = zipped(file, 'xl/workbook.xml');
    expect(workbook).toContain('fullCalcOnLoad="1"');
    // A table's header row on each printed page.
    expect(workbook).toContain(
      '<definedName name="_xlnm.Print_Titles" localSheetId="3">&apos;Products&apos;!$4:$4</definedName>',
    );
    expect(book.getWorksheet('Products')?.pageSetup).toMatchObject({
      orientation: 'landscape',
      fitToWidth: 1,
    });
    expect(XLSX_TYPE).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('opens on a dashboard of the headline figures, each beside the period before', async () => {
    const sheet = (await opened()).getWorksheet('Dashboard');
    expect(sheet?.getCell('B1').value).toBe('Sales report');
    expect(sheet?.getCell('B2').value).toBe(
      'Herbal Commerce · 20 Nov 2026 to 21 Nov 2026, compared with 18 Nov 2026 to 19 Nov 2026',
    );
    expect(sheet?.getCell('B3').value).toBe(
      'All sales · figures as of 25 Nov 2026, 12:10 India time · prepared by Ravi Kumar',
    );
    // Each tile: its name, its figure, the period before's and the change.
    const tile = (left: string, right: string, top: number) => [
      sheet?.getCell(`${left}${top}`).value,
      sheet?.getCell(`${left}${top + 1}`).value,
      sheet?.getCell(`${left}${top + 2}`).value,
      sheet?.getCell(`${right}${top + 2}`).value,
    ];
    expect(tile('B', 'D', 5)).toEqual([
      'Net sales (without GST)',
      1374,
      1000,
      0.374,
    ]);
    expect(tile('E', 'G', 5)).toEqual(['GST', 179, 0, 'New']);
    expect(tile('H', 'J', 5)).toEqual(['Paid in all', 1602, 0, 'New']);
    expect(tile('K', 'M', 5)).toEqual(['Orders', 4, 2, 1]);
    expect(tile('B', 'D', 9)).toEqual(['Average order', 451, null, null]);
    expect(tile('K', 'M', 9)).toEqual(['Returning customers', 1, 0, 'New']);
    expect(sheet?.getCell('B6').numFmt).toBe('"₹"#,##0;-"₹"#,##0');
    expect(sheet?.getCell('B7').numFmt).toBe(
      '"Before ₹"#,##0;"Before -₹"#,##0',
    );
    expect(sheet?.getCell('K7').numFmt).toBe('"Before "#,##0;"Before -"#,##0');
    expect(sheet?.getCell('D7').numFmt).toBe('"▲ "0%;"▼ "0%;0%');
    // A figure across its tile.
    expect(sheet?.getCell('D6').master.address).toBe('B6');
    expect(sheet?.getCell('C7').master.address).toBe('B7');
  });

  it('draws a chart of each day and of each grouping, each reading its sheet', async () => {
    const file = await made();
    expect(zipped(file, 'xl/worksheets/sheet1.xml')).toContain(
      '<drawing r:id="rIdSalesCharts"/></worksheet>',
    );
    expect(zipped(file, 'xl/worksheets/_rels/sheet1.xml.rels')).toContain(
      'Target="../drawings/drawing1.xml"',
    );
    const types = zipped(file, '[Content_Types].xml');
    expect(types).toContain(
      '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>',
    );
    const drawing = zipped(file, 'xl/drawings/drawing1.xml');
    expect(drawing.match(/<xdr:twoCellAnchor>/g)).toHaveLength(7);

    const charts = [1, 2, 3, 4, 5, 6, 7].map((n) => {
      expect(types).toContain(
        `<Override PartName="/xl/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
      );
      return zipped(file, `xl/charts/chart${n}.xml`);
    });
    const [days, products, categories, brands, states, methods, sizes] = charts;
    // Each day, its date as Excel's day number.
    expect(days).toContain('<c:barDir val="col"/>');
    expect(days).toContain(`<c:f>'Sales by day'!$A$5:$A$6</c:f>`);
    expect(days).toContain(`<c:f>'Sales by day'!$D$5:$D$6</c:f>`);
    expect(days).toContain(
      '<c:pt idx="0"><c:v>46346</c:v></c:pt><c:pt idx="1"><c:v>46347</c:v></c:pt>',
    );
    expect(days).toContain('<a:t>Net sales by day</a:t>');
    // Ranked bars, the best at the top, labelled with their net sales.
    expect(products).toContain('<c:barDir val="bar"/>');
    expect(products).toContain('<c:orientation val="maxMin"/>');
    expect(products).toContain('<c:showVal val="1"/>');
    expect(products).toContain(`<c:f>'Products'!$A$5:$A$8</c:f>`);
    expect(products).toContain(`<c:f>'Products'!$I$5:$I$8</c:f>`);
    // As the cell holds it, escaped for XML.
    expect(products).toContain(
      '<c:pt idx="2"><c:v>&apos;=HYPERLINK(&quot;x&quot;)</c:v></c:pt>',
    );
    expect(categories).toContain(`<c:f>'Categories'!$G$5:$G$7</c:f>`);
    expect(categories).toContain('<c:v>Not recorded</c:v>');
    expect(brands).toContain(
      '<c:v>Himalaya</c:v></c:pt><c:pt idx="1"><c:v>No brand</c:v></c:pt><c:pt idx="2"><c:v>Not recorded</c:v>',
    );
    expect(states).toContain(`<c:f>'States'!$E$5:$E$5</c:f>`);
    expect(methods).toContain('<c:v>Net banking</c:v>');
    expect(methods).toContain('<c:v>-428</c:v>');
    expect(sizes).toContain(`<c:f>'Pack sizes'!$A$5:$A$6</c:f>`);
    expect(sizes).toContain(`<c:f>'Pack sizes'!$K$5:$K$6</c:f>`);
    // Only the rows a sheet's filter shows.
    for (const chart of charts) {
      expect(chart).toContain('<c:plotVisOnly val="1"/>');
    }
  });

  it('charts only the best 10 of a grouping', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...DETAIL.products[0]!,
      productId: `p${i}`,
      name: `Product ${i}`,
    }));
    const file = await made({ detail: { ...DETAIL, products: many } });
    expect(zipped(file, 'xl/charts/chart2.xml')).toContain(
      `<c:f>'Products'!$I$5:$I$14</c:f>`,
    );
  });

  it('says so on the dashboard when nothing was sold, drawing no chart without a day', async () => {
    const book = await opened({ detail: NO_DETAIL, register: [] });
    const sheet = book.getWorksheet('Dashboard');
    expect(sheet?.getCell('B33').value).toBe(
      'Top 10 products: nothing sold in this period.',
    );
    expect(sheet?.getCell('H33').value).toBe(
      'Net sales by category: nothing sold in this period.',
    );
    const file = await made({ days: [], detail: NO_DETAIL, register: [] });
    expect(() => zipped(file, 'xl/drawings/drawing1.xml')).toThrow();
  });

  it('sums up the period beside the one before, in India’s time, saying who prepared it', async () => {
    const summary = rows((await opened()).getWorksheet('Summary'));
    expect(summary.slice(0, 9)).toEqual([
      ['Sales report'],
      ['Herbal Commerce'],
      [],
      ['Period', '20 Nov 2026 to 21 Nov 2026'],
      ['Compared with', '18 Nov 2026 to 19 Nov 2026'],
      ['Narrowed to', 'All sales'],
      ['Figures as of', '25 Nov 2026, 12:10 India time'],
      ['Prepared', '25 Nov 2026, 15:50 India time, by Ravi Kumar'],
      [],
    ]);
    expect(summary[9]).toEqual([
      'Figure',
      'This period',
      'Period before',
      'Change',
      'Change (%)',
    ]);
    expect(summary[10]).toEqual([
      'Sales (without GST, less refunds)',
      1374,
      1000,
      374,
      0.374,
    ]);
    // From nothing: new.
    expect(summary[11]).toEqual(['GST', 179, 0, 179, 'New']);
    expect(summary[13]?.[0]).toBe('Paid in all (with GST and delivery)');
    expect(summary[15]).toEqual([
      'Average order (without GST, before refunds)',
      451,
      'No orders',
    ]);
    expect(summary.flat()).toContain(
      'GST invoice numbers and the CGST, SGST and IGST split come once the company is registered.',
    );
  });

  it('says what a narrowed file counts, and that delivery is not split by product', async () => {
    const book = await opened({ report: NARROWED });
    const summary = rows(book.getWorksheet('Summary'));
    expect(summary[10]).toEqual([
      'Sales (without GST, less refunds)',
      -428,
      1000,
      -1428,
    ]);
    expect(summary[5]).toEqual([
      'Narrowed to',
      'Product: Ashwagandha Capsules; Category: Wellness › Immunity; Brand: Not recorded',
    ]);
    expect(summary[12]).toEqual([
      'Delivery',
      'Not split by product',
      'Not split by product',
    ]);
    expect(summary[13]?.[0]).toBe('Paid for these (with GST)');
    expect(book.getWorksheet('Dashboard')?.getCell('H5').value).toBe(
      'Paid for these',
    );
    // No delivery column by day, state or method either.
    expect(rows(book.getWorksheet('Sales by day'))[3]).toEqual([
      'Date',
      'Day',
      'Orders',
      'Net sales',
      'GST',
      'Paid for these',
      'Orders refunded',
      'Refunds',
    ]);
    expect(rows(book.getWorksheet('States'))[3]?.slice(1, 7)).toEqual([
      'Orders',
      'Gross sales',
      'Refunds',
      'Net sales',
      'GST',
      'Paid for these (with GST)',
    ]);
    expect(rows(book.getWorksheet('Products'))[1]).toEqual([
      '20 Nov 2026 to 21 Nov 2026, compared with 18 Nov 2026 to 19 Nov 2026 · Product: Ashwagandha Capsules; Category: Wellness › Immunity; Brand: Not recorded',
    ]);
    expect(salesFileName(NARROWED)).toBe(
      'herbal-commerce-sales-2026-11-20-to-2026-11-21-narrowed.xlsx',
    );
    expect(salesFileName(REPORT)).toBe(
      'herbal-commerce-sales-2026-11-20-to-2026-11-21.xlsx',
    );
  });

  it('names a state and a way of paying it is narrowed to, its delivery still split', async () => {
    const placed: SalesReport = {
      ...REPORT,
      filters: {
        ...REPORT.filters,
        state: { state: 'Kerala' },
        method: { method: null },
      },
    };
    const summary = rows(
      (await opened({ report: placed })).getWorksheet('Summary'),
    );
    expect(summary[5]).toEqual([
      'Narrowed to',
      'State: Kerala; Payment method: Not recorded',
    ]);
    expect(summary[12]?.slice(0, 3)).toEqual(['Delivery', 49, 0]);
    expect(summary[13]?.[0]).toBe('Paid in all (with GST and delivery)');
    expect(salesFileName(placed)).toBe(
      'herbal-commerce-sales-2026-11-20-to-2026-11-21-narrowed.xlsx',
    );
    const byCard: SalesReport = {
      ...REPORT,
      filters: { ...REPORT.filters, method: { method: 'CARD' } },
    };
    expect(salesFileName(byCard)).toBe(
      'herbal-commerce-sales-2026-11-20-to-2026-11-21-narrowed.xlsx',
    );
    expect(
      rows((await opened({ report: byCard })).getWorksheet('Summary'))[5],
    ).toEqual(['Narrowed to', 'Payment method: Card']);
  });

  it('gives each day as a date and its weekday, under filter buttons, with a total of the rows shown', async () => {
    const sheet = (await opened()).getWorksheet('Sales by day');
    const days = rows(sheet);
    expect(days.slice(0, 3)).toEqual([
      ['Sales by day'],
      [TITLES[0]],
      [TITLES[1]],
    ]);
    expect(days[3]).toEqual([
      'Date',
      'Day',
      'Orders',
      'Net sales',
      'GST',
      'Delivery',
      'Paid',
      'Orders refunded',
      'Refunds',
    ]);
    expect(days[4]).toEqual([
      new Date('2026-11-20T00:00:00.000Z'),
      'Fri',
      4,
      1802,
      10,
      49,
      1861,
      0,
      0,
    ]);
    expect(days[5]?.slice(0, 4)).toEqual([
      new Date('2026-11-21T00:00:00.000Z'),
      'Sat',
      0,
      -428,
    ]);
    // Apart from the rows, so a filter never hides it.
    expect(days[6]).toEqual([]);
    expect(days[7]).toEqual(['Total', undefined, 4, 1374, 20, 98, 1492, 0, 0]);
    expect(sheet?.getCell('D8').value).toEqual({
      formula: 'SUBTOTAL(109,D5:D6)',
      result: 1374,
    });
    expect(sheet?.autoFilter).toBe('A4:I6');
    expect(sheet?.views[0]).toMatchObject({
      state: 'frozen',
      xSplit: 1,
      ySplit: 4,
    });
    expect(sheet?.getCell('D5').numFmt).toBe('"₹"#,##0;-"₹"#,##0');
    expect(sheet?.getCell('A5').numFmt).toBe('dd mmm yyyy');
  });

  it('lists every product with its grouping, packs and rupees, beside the period before', async () => {
    const sheet = (await opened()).getWorksheet('Products');
    const products = rows(sheet);
    expect(products[3]).toEqual([
      'Product',
      'Category',
      'Subcategory',
      'Brand',
      'Packs sold',
      'Packs refunded',
      'Gross sales',
      'Refunds',
      'Net sales',
      'GST',
      'Net sales with GST',
      'Share of net sales',
      'Net sales, period before',
      'Change',
      'Change (%)',
    ]);
    expect(products[4]).toEqual([
      'Ashwagandha Capsules',
      'Wellness',
      'Immunity',
      'Himalaya',
      3,
      1,
      1284,
      428,
      856,
      43,
      899,
      856 / 1374,
      1000,
      -144,
      -0.144,
    ]);
    // New since the period before; no brand.
    expect(products[5]?.slice(0, 4)).toEqual([
      'Tulsi Tea',
      'Herbal Teas',
      '',
      'No brand',
    ]);
    expect(products[5]?.slice(12)).toEqual([0, 344, 'New']);
    // An old line with nothing recorded, its name kept as text.
    expect(products[6]?.slice(0, 4)).toEqual([
      '\'=HYPERLINK("x")',
      'Not recorded',
      '',
      'Not recorded',
    ]);
    // Sold only before: all of it gone.
    expect(products[7]?.slice(8)).toEqual([0, 0, 0, 0, 300, -300, -1]);
    expect(products[9]).toEqual([
      'Total',
      undefined,
      undefined,
      undefined,
      6,
      1,
      1802,
      428,
      1374,
      125,
      1499,
      1,
      1500,
      -126,
      -0.084,
    ]);
    expect(sheet?.getCell('O10').value).toEqual({
      formula:
        'IF(AND(M10>0,I10>=0),(I10-M10)/M10,IF(AND(M10=0,I10>0),"New",""))',
      result: -0.084,
    });
    expect(sheet?.getCell('O5').numFmt).toBe('+0%;-0%;0%');
    expect(sheet?.getCell('L5').numFmt).toBe('0.0%;-0.0%');
    expect(sheet?.autoFilter).toBe('A4:O8');
  });

  it('lists each pack size from the register, named as it last sold', async () => {
    const sizes = rows((await opened()).getWorksheet('Pack sizes'));
    expect(sizes[3]).toEqual([
      'SKU',
      'Product',
      'Category',
      'Subcategory',
      'Brand',
      'GST rate',
      'Packs sold',
      'Packs refunded',
      'Gross sales',
      'Refunds',
      'Net sales',
      'GST',
      'Net sales with GST',
      'Share of net sales',
    ]);
    expect(sizes[4]).toEqual([
      'ASH-60',
      'Ashwagandha Capsules 60',
      'Wellness',
      'Immunity',
      'Himalaya',
      5,
      3,
      1,
      1284,
      428,
      856,
      42,
      898,
      856 / 1028,
    ]);
    expect(sizes[5]?.slice(0, 5)).toEqual([
      'TUL-100',
      'Tulsi Tea',
      'Herbal Teas',
      '',
      'No brand',
    ]);
    // No delivery lines: the two pack sizes, then their total.
    expect(sizes[6]).toEqual([]);
    expect(sizes[7]?.slice(6, 13)).toEqual([4, 1, 1456, 428, 1028, 51, 1079]);
  });

  it('lists the categories, each one’s subcategories with what sold in it directly, and the brands', async () => {
    const book = await opened();
    const categories = rows(book.getWorksheet('Categories'));
    expect(categories[3]?.slice(0, 3)).toEqual([
      'Category',
      'Products sold',
      'Packs sold',
    ]);
    expect(categories.slice(4, 7).map((row) => row.slice(0, 2))).toEqual([
      ['Wellness', 1],
      ['Herbal Teas', 1],
      ['Not recorded', 1],
    ]);
    // How many products sold is no sum: one may be in two.
    expect(categories[8]?.slice(0, 3)).toEqual(['Total', undefined, 6]);
    const subcategories = rows(book.getWorksheet('Subcategories'));
    expect(subcategories.slice(4, 7).map((row) => row.slice(0, 3))).toEqual([
      ['Wellness', 'Immunity', 1],
      ['Wellness', 'Not in a subcategory', 0],
      ['Not recorded', '', 1],
    ]);
    const brands = rows(book.getWorksheet('Brands'));
    expect(brands.slice(4, 7).map((row) => row.slice(0, 2))).toEqual([
      ['Himalaya', 1],
      ['No brand', 1],
      ['Not recorded', 1],
    ]);
  });

  it('lists the states and payment methods with their orders, delivery and what was paid', async () => {
    const book = await opened();
    const states = rows(book.getWorksheet('States'));
    expect(states[0]).toEqual(['Sales by state delivered to']);
    expect(states[3]).toEqual([
      'State',
      'Orders',
      'Gross sales',
      'Refunds',
      'Net sales',
      'GST',
      'Delivery',
      'Paid (with GST and delivery)',
      'Share of net sales',
      'Net sales, period before',
      'Change',
      'Change (%)',
    ]);
    expect(states[4]).toEqual([
      'Karnataka',
      4,
      1802,
      428,
      1374,
      125,
      49,
      1548,
      1,
      1000,
      374,
      0.374,
    ]);
    const methods = rows(book.getWorksheet('Payment methods'));
    expect(methods.slice(4, 6).map((row) => row.slice(0, 2))).toEqual([
      ['Net banking', 4],
      ['Not recorded', 0],
    ]);
    // Down past 0 from nothing: no share of it.
    expect(methods[5]?.slice(9)).toEqual([0, -428]);
  });

  it('registers each line sold or refunded at its time in India, refunds below 0, delivery on its own line', async () => {
    const sheet = (await opened()).getWorksheet('Sales register');
    const register = rows(sheet);
    expect(register[3]).toEqual([
      'Date and time (India)',
      'Type',
      'Order',
      'Product',
      'SKU',
      'Category',
      'Subcategory',
      'Brand',
      'State',
      'Payment method',
      'Packs',
      'Price without GST',
      'GST rate',
      'GST',
      'Total',
    ]);
    expect(register[4]).toEqual([
      new Date('2026-11-20T00:00:00.000Z'),
      'Sale',
      'BBBBBBBBBB',
      'Ashwagandha Capsules',
      'ASH-60',
      'Wellness',
      'Immunity',
      'Himalaya',
      'Kerala',
      'Card',
      1,
      428,
      5,
      21,
      449,
    ]);
    expect(register[5]?.slice(1, 4)).toEqual([
      'Delivery charge',
      'BBBBBBBBBB',
      '',
    ]);
    // A delivery charge has no packs and no GST rate of its own.
    expect(register[5]?.slice(10)).toEqual([undefined, 49, undefined, 0, 49]);
    expect(register[6]?.slice(1, 2)).toEqual(['Refund']);
    expect(register[6]?.slice(10)).toEqual([-1, -428, 5, -21, -449]);
    expect(register[7]?.[1]).toBe('Delivery refunded');
    expect(register[9]?.[7]).toBe('No brand');
    expect(register[11]).toEqual([
      'Total',
      ...Array(9).fill(undefined),
      3,
      1028,
      undefined,
      51,
      1079,
    ]);
    expect(sheet?.autoFilter).toBe('A4:O10');
  });

  it('gives no share of sales that come to nothing', async () => {
    const even: SalesDetail = {
      ...DETAIL,
      products: [
        { ...DETAIL.products[0]!, ...figures(1, 0, 428, 0, 21, 0) },
        { ...DETAIL.products[1]!, ...figures(0, 1, 0, 428, -21, 0) },
      ],
    };
    const products = rows(
      (await opened({ detail: even })).getWorksheet('Products'),
    );
    expect(products[4]?.[11]).toBeUndefined();
    expect(products[5]?.[11]).toBeUndefined();
  });

  it('ranks the pack sizes by their net sales', async () => {
    const tulsiFirst = [REGISTER[5]!, ...REGISTER.slice(0, 5)];
    const sizes = rows(
      (await opened({ register: tulsiFirst })).getWorksheet('Pack sizes'),
    );
    expect([sizes[4]?.[0], sizes[5]?.[0]]).toEqual(['ASH-60', 'TUL-100']);
  });

  it('says so when nothing was sold', async () => {
    const book = await opened({ detail: NO_DETAIL, register: [] });
    expect(rows(book.getWorksheet('Sales register'))[4]).toEqual([
      'Nothing was sold or refunded in this period.',
    ]);
    expect(rows(book.getWorksheet('Products'))[4]).toEqual([
      'Nothing was sold in this period or the one before.',
    ]);
    expect(rows(book.getWorksheet('Pack sizes'))[4]).toEqual([
      'Nothing was sold in this period.',
    ]);
  });
});

describe('safeText', () => {
  it('keeps text a spreadsheet could take for a formula as text', () => {
    for (const text of ['=1+1', '+91', '-5', '@SUM(A1)', '\tx', '\rx']) {
      expect(safeText(text)).toBe(`'${text}`);
    }
    for (const text of ['Ashwagandha', '5 packs', 'a=b', '']) {
      expect(safeText(text)).toBe(text);
    }
  });
});
