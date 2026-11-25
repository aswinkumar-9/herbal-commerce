import { inflateRawSync } from 'node:zlib';
import { Workbook } from 'exceljs';
import type { Worksheet } from 'exceljs';
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
  filters: { product: null, category: null, brand: null },
  previousPeriod: { from: '2026-11-18', to: '2026-11-19' },
  refreshedAt: new Date('2026-11-25T06:40:00.000Z'),
  totals: TOTALS,
  previousTotals: { ...NONE, salesRupees: 1000, orders: 2 },
  series: { unit: 'day', points: [] },
  products: [
    {
      productId: 'p1',
      name: 'Ashwagandha Capsules',
      salesRupees: 1200,
      packs: 3,
    },
    { productId: null, name: '=HYPERLINK("x")', salesRupees: 174, packs: 1 },
  ],
  categories: [
    {
      categoryId: 'c1',
      name: 'Wellness',
      salesRupees: 1200,
      subcategories: [{ categoryId: 'c2', name: 'Immunity', salesRupees: 900 }],
    },
    { categoryId: null, name: null, salesRupees: 174, subcategories: [] },
  ],
  brands: [
    { brandId: 'b1', name: 'Himalaya', recorded: true, salesRupees: 1200 },
    { brandId: null, name: null, recorded: true, salesRupees: 100 },
    { brandId: null, name: null, recorded: false, salesRupees: 74 },
  ],
  states: [{ state: 'Karnataka', salesRupees: 1374, orders: 4 }],
  methods: [
    { method: 'NETBANKING', salesRupees: 1802, orders: 4 },
    { method: null, salesRupees: -428, orders: 0 },
  ],
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
];

const made = (report = REPORT, register = REGISTER) =>
  salesWorkbook({
    report,
    days: DAYS,
    register,
    preparedAt: new Date('2026-11-25T10:20:00.000Z'),
    preparedBy: 'Ravi Kumar',
  });

async function opened(report = REPORT, register = REGISTER) {
  const file = await made(report, register);
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

describe('salesWorkbook', () => {
  it('makes an Excel file of sheets a company reads: a summary, each day, each grouping and the register', async () => {
    const book = await opened();
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
      'Summary',
      'Sales by day',
      'By product',
      'By category',
      'By brand',
      'By state',
      'By payment method',
      'Sales register',
    ]);
    expect(book.creator).toBe('Herbal Commerce');
    // Excel works every total out again as it opens the file.
    expect(zipped(await made(), 'xl/workbook.xml')).toContain(
      'fullCalcOnLoad="1"',
    );
    expect(XLSX_TYPE).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
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
    // From nothing: a change, but no share of it.
    expect(summary[11]).toEqual(['GST', 179, 0, 179]);
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
    const narrowed: SalesReport = {
      ...REPORT,
      filters: {
        product: { productId: 'p1', name: 'Ashwagandha Capsules' },
        category: {
          categoryId: 'c2',
          name: 'Immunity',
          parentName: 'Wellness',
        },
        brand: { brandId: 'b9', name: null },
      },
      // More refunded than sold: down past 0 is no share of what it was.
      totals: { ...TOTALS, salesRupees: -428, deliveryRupees: null },
      previousTotals: { ...NONE, salesRupees: 1000, deliveryRupees: null },
    };
    const book = await opened(narrowed);
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
    // No delivery column by day either.
    expect(rows(book.getWorksheet('Sales by day'))[0]).toEqual([
      'Date',
      'Orders',
      'Sales',
      'GST',
      'Paid for these',
      'Orders refunded',
      'Refunds',
    ]);
    expect(salesFileName(narrowed)).toBe(
      'herbal-commerce-sales-2026-11-20-to-2026-11-21-narrowed.xlsx',
    );
    expect(salesFileName(REPORT)).toBe(
      'herbal-commerce-sales-2026-11-20-to-2026-11-21.xlsx',
    );
  });

  it('gives each day as a date, with a total row that adds them up', async () => {
    const sheet = (await opened()).getWorksheet('Sales by day');
    const days = rows(sheet);
    expect(days[0]).toEqual([
      'Date',
      'Orders',
      'Sales',
      'GST',
      'Delivery',
      'Paid',
      'Orders refunded',
      'Refunds',
    ]);
    expect(days[1]).toEqual([
      new Date('2026-11-20T00:00:00.000Z'),
      4,
      1802,
      10,
      49,
      1861,
      0,
      0,
    ]);
    expect(days[3]).toEqual(['Total', 4, 1374, 20, 98, 1492, 0, 0]);
    expect(sheet?.getCell('C4').value).toEqual({
      formula: 'SUM(C2:C3)',
      result: 1374,
    });
    expect(sheet?.getCell('C2').numFmt).toBe('"₹"#,##0;-"₹"#,##0');
    expect(sheet?.getCell('A2').numFmt).toBe('dd mmm yyyy');
  });

  it('lists every grouping, naming what has no name, a category before its subcategories', async () => {
    const book = await opened();
    expect(rows(book.getWorksheet('By product'))).toEqual([
      ['Product', 'Packs', 'Sales'],
      ['Ashwagandha Capsules', 3, 1200],
      ['\'=HYPERLINK("x")', 1, 174],
      ['Total', 4, 1374],
    ]);
    expect(rows(book.getWorksheet('By category'))).toEqual([
      ['Category', 'Subcategory', 'Sales'],
      ['Wellness', 'All', 1200],
      ['Wellness', 'Immunity', 900],
      ['Not recorded', 'All', 174],
    ]);
    expect(rows(book.getWorksheet('By brand')).slice(1, 4)).toEqual([
      ['Himalaya', 1200],
      ['No brand', 100],
      ['Not recorded', 74],
    ]);
    expect(rows(book.getWorksheet('By payment method'))).toEqual([
      ['Payment method', 'Orders', 'Sales'],
      ['Net banking', 4, 1802],
      ['Not recorded', 0, -428],
      ['Total', 4, 1374],
    ]);
  });

  it('registers each line sold or refunded at its time in India, refunds below 0, delivery on its own line', async () => {
    const sheet = (await opened()).getWorksheet('Sales register');
    const register = rows(sheet);
    expect(register[0]).toEqual([
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
    expect(register[1]).toEqual([
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
    expect(register[2]?.slice(1, 4)).toEqual([
      'Delivery charge',
      'BBBBBBBBBB',
      '',
    ]);
    // A delivery charge has no packs and no GST rate of its own.
    expect(register[2]?.slice(10)).toEqual([undefined, 49, undefined, 0, 49]);
    expect(register[3]?.slice(1, 2)).toEqual(['Refund']);
    expect(register[3]?.slice(10)).toEqual([-1, -428, 5, -21, -449]);
    expect(register[4]?.[1]).toBe('Delivery refunded');
    expect(register[5]).toEqual([
      'Total',
      ...Array(9).fill(undefined),
      0,
      0,
      undefined,
      0,
      0,
    ]);
    expect(sheet?.autoFilter).toBe('A1:O5');
    expect(sheet?.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('says so when nothing was sold', async () => {
    const register = rows(
      (await opened(REPORT, [])).getWorksheet('Sales register'),
    );
    expect(register[1]).toEqual([
      'Nothing was sold or refunded in this period.',
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
