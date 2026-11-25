import { Workbook } from 'exceljs';
import type { PaperSize, Row, Worksheet } from 'exceljs';
import type { PaymentMethod } from '../generated/prisma/enums';
import { type SheetChart, withCharts } from './sales-charts';
import type { GroupFigures, PlaceFigures, SalesDetail } from './sales-detail';
import type {
  RegisterLine,
  SalesDay,
  SalesFilters,
  SalesReport,
  SalesTotals,
} from './sales-report.service';

// The sales report as an Excel workbook (part 15D, ADR 0047), as a
// company's sales report reads: a dashboard of the headline figures and
// charts, a summary beside the period before, each day, each grouping in
// full (products, pack sizes, categories, subcategories, brands, states and
// payment methods), and the register of every line sold or refunded. Every
// table has filter and sort buttons, and a total of what it shows. GST
// invoice numbers and the CGST, SGST and IGST split wait until the company
// is registered (ADR 0026).

export interface SalesWorkbookInput {
  report: SalesReport;
  days: SalesDay[];
  detail: SalesDetail;
  register: RegisterLine[];
  // When, and by whom.
  preparedAt: Date;
  preparedBy: string;
}

export const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Whole rupees, and counts, grouped as the computer groups them.
const RUPEES = '"₹"#,##0;-"₹"#,##0';
const COUNT = '#,##0;-#,##0';
const SHARE = '0.0%;-0.0%';
const CHANGE = '+0%;-0%;0%';
const DAY = 'dd mmm yyyy';
const MOMENT = 'dd mmm yyyy hh:mm';
const RATE = '0"%"';
// A dashboard tile's period before, and its change.
const BEFORE_RUPEES = '"Before ₹"#,##0;"Before -₹"#,##0';
const BEFORE_COUNT = '"Before "#,##0;"Before -"#,##0';
const TILE_CHANGE = '"▲ "0%;"▼ "0%;0%';

// The console's greens and inks (part 15D), as Excel takes colours.
const GREEN = 'FF1F7A55';
const WHITE = 'FFFFFFFF';
const PALE = 'FFF1F6F3';
const EDGE = 'FFC9D8CE';
const MUTED = 'FF4A5A51';

const METHOD_NAMES: Record<PaymentMethod, string> = {
  UPI: 'UPI',
  CARD: 'Card',
  NETBANKING: 'Net banking',
  WALLET: 'Wallet',
  EMI: 'EMI',
  PAY_LATER: 'Pay later',
  OTHER: 'Other',
};
const NOT_RECORDED = 'Not recorded';
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Printed across a page of A4, the header row on each.
const PRINTED = {
  orientation: 'landscape',
  paperSize: 9 as PaperSize,
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 0,
} as const;

// Text a spreadsheet could take for a formula once copied out as plain
// text, such as a CSV: starting with =, +, -, @, a tab or a return. Led by
// an apostrophe, it stays text. Names come from staff and customers.
export function safeText(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

// A day as Excel keeps dates: exceljs writes the time in UTC, so a day at
// midnight UTC is that day, and a time in India shifted by 5:30 reads as
// India's.
const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const indiaDate = (indiaText: string) =>
  new Date(`${indiaText.replace(' ', 'T')}.000Z`);
const indiaOf = (at: Date) => new Date(at.getTime() + 330 * 60_000);
// The same day as Excel's day number, for a chart.
const daySerial = (day: string) =>
  (dayDate(day).getTime() - Date.UTC(1899, 11, 30)) / 86_400_000;

// "25 Nov 2026"; "25 Nov 2026, 15:50".
function dayName(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return `${date} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}
function momentName(at: Date): string {
  const india = indiaOf(at).toISOString();
  return `${dayName(india.slice(0, 10))}, ${india.slice(11, 16)}`;
}
const periodName = ({ from, to }: { from: string; to: string }) =>
  from === to ? dayName(from) : `${dayName(from)} to ${dayName(to)}`;

const isNarrowed = (filters: SalesFilters) =>
  Boolean(filters.product ?? filters.category ?? filters.brand);

function narrowedName(filters: SalesFilters): string {
  const parts = [
    filters.product ? `Product: ${filters.product.name ?? NOT_RECORDED}` : null,
    filters.category
      ? `Category: ${
          filters.category.parentName ? `${filters.category.parentName} › ` : ''
        }${filters.category.name ?? NOT_RECORDED}`
      : null,
    filters.brand ? `Brand: ${filters.brand.name ?? NOT_RECORDED}` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join('; ') : 'All sales';
}

// The file's name: the shop, the period, and whether it is narrowed.
export function salesFileName(report: SalesReport): string {
  const { from, to } = report.period;
  const narrowed = isNarrowed(report.filters) ? '-narrowed' : '';
  return `herbal-commerce-sales-${from}-to-${to}${narrowed}.xlsx`;
}

// A change on the period before, as a share of it: none from nothing or
// from less (but new, from nothing), or down past 0.
function changeOf(now: number | null, before: number | null) {
  if (now === null || before === null) {
    return null;
  }
  if (before > 0 && now >= 0) {
    return (now - before) / before;
  }
  return before === 0 && now > 0 ? 'New' : null;
}

// A column's letter: A for the first.
function letterOf(index: number): string {
  let letter = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
  }
  return letter;
}

// A table's header: white on the console's green, wrapped, kept in view.
function header(row: Row) {
  row.font = { bold: true, color: { argb: WHITE } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 30;
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };
  });
}

const sum = <T>(items: T[], pick: (item: T) => number) =>
  items.reduce((total, item) => total + pick(item), 0);

type Value = string | number | Date | null;
interface Column<T> {
  name: string;
  width: number;
  // A number's format; a column without one holds text.
  format?: string;
  value: (item: T) => Value;
  // Its total of the rows shown, or the change of the totals.
  total?: 'sum' | 'change';
}

// Where a table's rows are, and its columns' letters by name.
interface Table {
  first: number;
  last: number;
  letters: Map<string, string>;
}

// Each table's title, what it covers, and a line on reading it.
const HEADER_ROW = 4;
function titled(
  sheet: Worksheet,
  input: SalesWorkbookInput,
  title: string,
  note: string,
) {
  const { report } = input;
  sheet.addRow([title]).font = { bold: true, size: 14 };
  sheet.addRow([
    safeText(
      `${periodName(report.period)}, compared with ${periodName(
        report.previousPeriod,
      )} · ${narrowedName(report.filters)}`,
    ),
  ]).font = { color: { argb: MUTED } };
  sheet.addRow([note]).font = { color: { argb: MUTED } };
}

const NET = 'Net sales';
const BEFORE = 'Net sales, period before';
const CHANGE_SHARE = 'Change (%)';

// A sheet of one table: a row for each item, filter and sort buttons on
// its header, and a total of the rows shown under it, apart, so a filter
// never hides it.
function tableSheet<T>(
  book: Workbook,
  name: string,
  input: SalesWorkbookInput,
  title: string,
  note: string,
  columns: Column<T>[],
  items: T[],
  empty: string,
): Table {
  const sheet = book.addWorksheet(name, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: HEADER_ROW }],
    pageSetup: { ...PRINTED, printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}` },
  });
  sheet.columns = columns.map((column) => ({ width: column.width }));
  titled(sheet, input, title, note);
  header(sheet.addRow(columns.map((column) => column.name)));
  const letters = new Map(
    columns.map((column, i) => [column.name, letterOf(i)]),
  );
  const first = HEADER_ROW + 1;
  if (items.length === 0) {
    sheet.addRow([empty]);
    return { first, last: HEADER_ROW, letters };
  }
  for (const item of items) {
    const row = sheet.addRow(
      columns.map((column) => {
        const value = column.value(item);
        return typeof value === 'string' ? safeText(value) : value;
      }),
    );
    columns.forEach((column, i) => {
      if (column.format) {
        const cell = row.getCell(i + 1);
        cell.numFmt = column.format;
        cell.alignment = { horizontal: 'right' };
      }
    });
  }
  const last = first + items.length - 1;
  sheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: last, column: columns.length },
  };

  sheet.addRow([]);
  const totals = sheet.addRow(['Total']);
  const totalOf = (column: Column<T>) =>
    sum(items, (item) => {
      const value = column.value(item);
      return typeof value === 'number' ? value : 0;
    });
  const net = columns.find((column) => column.name === NET);
  const before = columns.find((column) => column.name === BEFORE);
  columns.forEach((column, i) => {
    const cell = totals.getCell(i + 1);
    const letter = letterOf(i);
    if (column.total === 'sum') {
      cell.value = {
        formula: `SUBTOTAL(109,${letter}${first}:${letter}${last})`,
        result: totalOf(column),
      };
    } else if (column.total === 'change' && net && before) {
      const now = `${letters.get(NET)}${totals.number}`;
      const was = `${letters.get(BEFORE)}${totals.number}`;
      const result = changeOf(totalOf(net), totalOf(before));
      cell.value = {
        formula: `IF(AND(${was}>0,${now}>=0),(${now}-${was})/${was},IF(AND(${was}=0,${now}>0),"New",""))`,
        result: result ?? '',
      };
    }
    if (column.format) {
      cell.numFmt = column.format;
      cell.alignment = { horizontal: 'right' };
    }
    cell.border = { top: { style: 'thin', color: { argb: GREEN } } };
  });
  totals.font = { bold: true };
  return { first, last, letters };
}

// The share of the period's net sales, the period before's, and the
// change, after a grouping's own figures.
function comparing<
  T extends { salesRupees: number; previousSalesRupees: number },
>(items: T[]): Column<T>[] {
  const total = sum(items, (item) => item.salesRupees);
  return [
    {
      name: 'Share of net sales',
      width: 11,
      format: SHARE,
      value: (item) => (total > 0 ? item.salesRupees / total : null),
      total: 'sum',
    },
    {
      name: BEFORE,
      width: 15,
      format: RUPEES,
      value: (item) => item.previousSalesRupees,
      total: 'sum',
    },
    {
      name: 'Change',
      width: 13,
      format: RUPEES,
      value: (item) => item.salesRupees - item.previousSalesRupees,
      total: 'sum',
    },
    {
      name: CHANGE_SHARE,
      width: 11,
      format: CHANGE,
      value: (item) => changeOf(item.salesRupees, item.previousSalesRupees),
      total: 'change',
    },
  ];
}

// What a grouping sold and what went back, in packs and rupees.
function sold<
  T extends Omit<GroupFigures, 'previousSalesRupees'>,
>(): Column<T>[] {
  return [
    {
      name: 'Packs sold',
      width: 10,
      format: COUNT,
      value: (item) => item.soldPacks,
      total: 'sum',
    },
    {
      name: 'Packs refunded',
      width: 10,
      format: COUNT,
      value: (item) => item.refundedPacks,
      total: 'sum',
    },
    {
      name: 'Gross sales',
      width: 13,
      format: RUPEES,
      value: (item) => item.grossRupees,
      total: 'sum',
    },
    {
      name: 'Refunds',
      width: 12,
      format: RUPEES,
      value: (item) => item.refundRupees,
      total: 'sum',
    },
    {
      name: NET,
      width: 13,
      format: RUPEES,
      value: (item) => item.salesRupees,
      total: 'sum',
    },
    {
      name: 'GST',
      width: 11,
      format: RUPEES,
      value: (item) => item.gstRupees,
      total: 'sum',
    },
    {
      name: 'Net sales with GST',
      width: 13,
      format: RUPEES,
      value: (item) => item.salesRupees + item.gstRupees,
      total: 'sum',
    },
  ];
}

const productsSold = <T extends { products: number }>(): Column<T> => ({
  name: 'Products sold',
  width: 10,
  format: COUNT,
  value: (item) => item.products,
});

const READING =
  'Amounts in rupees, without GST unless a column says so. Filter or sort with the buttons on the header row: the Total row adds up the rows shown.';

interface Figure {
  label: string;
  format: string;
  pick: (totals: SalesTotals) => number | null;
  // What a figure that has none says.
  none: string;
}

function figuresOf(narrowed: boolean): Figure[] {
  return [
    {
      label: 'Sales (without GST, less refunds)',
      format: RUPEES,
      pick: (t) => t.salesRupees,
      none: '',
    },
    { label: 'GST', format: RUPEES, pick: (t) => t.gstRupees, none: '' },
    {
      label: 'Delivery',
      format: RUPEES,
      pick: (t) => t.deliveryRupees,
      none: 'Not split by product',
    },
    {
      label: narrowed
        ? 'Paid for these (with GST)'
        : 'Paid in all (with GST and delivery)',
      format: RUPEES,
      pick: (t) => t.paidRupees,
      none: '',
    },
    { label: 'Orders', format: COUNT, pick: (t) => t.orders, none: '' },
    {
      label: 'Average order (without GST, before refunds)',
      format: RUPEES,
      pick: (t) => t.averageOrderRupees,
      none: 'No orders',
    },
    {
      label: 'Orders refunded',
      format: COUNT,
      pick: (t) => t.refundedOrders,
      none: '',
    },
    {
      label: 'Refunds',
      format: RUPEES,
      pick: (t) => t.refundedRupees,
      none: '',
    },
    {
      label: 'New customers',
      format: COUNT,
      pick: (t) => t.newCustomers,
      none: '',
    },
    {
      label: 'Returning customers',
      format: COUNT,
      pick: (t) => t.returningCustomers,
      none: '',
    },
  ];
}

function summarySheet(book: Workbook, input: SalesWorkbookInput) {
  const { report } = input;
  const narrowed = isNarrowed(report.filters);
  const sheet = book.addWorksheet('Summary', {
    views: [{ showGridLines: false }],
    pageSetup: PRINTED,
  });
  sheet.columns = [
    { width: 44 },
    { width: 18 },
    { width: 18 },
    { width: 16 },
    { width: 12 },
  ];
  const title = sheet.addRow(['Sales report']);
  title.font = { bold: true, size: 16 };
  sheet.addRow(['Herbal Commerce']);
  sheet.addRow([]);
  for (const [name, value] of [
    ['Period', periodName(report.period)],
    ['Compared with', periodName(report.previousPeriod)],
    ['Narrowed to', safeText(narrowedName(report.filters))],
    [
      'Figures as of',
      report.refreshedAt
        ? `${momentName(report.refreshedAt)} India time`
        : 'Not yet worked out',
    ],
    [
      'Prepared',
      safeText(
        `${momentName(input.preparedAt)} India time, by ${input.preparedBy}`,
      ),
    ],
  ]) {
    const row = sheet.addRow([name, value]);
    row.getCell(1).font = { bold: true };
  }
  sheet.addRow([]);

  header(
    sheet.addRow([
      'Figure',
      'This period',
      'Period before',
      'Change',
      'Change (%)',
    ]),
  );
  for (const figure of figuresOf(narrowed)) {
    const now = figure.pick(report.totals);
    const before = figure.pick(report.previousTotals);
    const row = sheet.addRow([
      figure.label,
      now ?? figure.none,
      before ?? figure.none,
      now !== null && before !== null ? now - before : null,
      changeOf(now, before),
    ]);
    for (const column of [2, 3, 4]) {
      row.getCell(column).numFmt = figure.format;
    }
    row.getCell(5).numFmt = CHANGE;
    row.getCell(5).alignment = { horizontal: 'right' };
  }
  sheet.addRow([]);
  sheet.addRow(['Notes']).font = { bold: true };
  for (const note of [
    'Sales are what the products sold for, without the GST in their prices, less what was refunded: gross sales less refunds, the net sales of each sheet.',
    'A payment counts on the day in India it was paid; a refund comes off on the day it was made.',
    'Each period is compared with the one of the same length just before it. Each sheet lists all that sold in either.',
    'Every sheet after this one has filter and sort buttons on its header row. Its Total row adds up only the rows shown, and its chart on the Dashboard shows only them.',
    'Pack sizes come from the sales register: what each SKU sold, in this period.',
    ...(narrowed
      ? [
          'Narrowed: every figure counts only these products. Delivery is charged on whole orders, so it is not split by product.',
          'New customers paid for the first time ever, for anything, in an order with these in.',
        ]
      : []),
    'GST invoice numbers and the CGST, SGST and IGST split come once the company is registered.',
  ]) {
    sheet.addRow([note]);
  }
}

function daySheet(book: Workbook, input: SalesWorkbookInput): Table {
  const narrowed = isNarrowed(input.report.filters);
  const columns: Column<SalesDay>[] = [
    {
      name: 'Date',
      width: 13,
      format: DAY,
      value: (day) => dayDate(day.day),
    },
    {
      name: 'Day',
      width: 6,
      value: (day) => WEEKDAYS[dayDate(day.day).getUTCDay()] ?? '',
    },
    {
      name: 'Orders',
      width: 9,
      format: COUNT,
      value: (day) => day.orders,
      total: 'sum',
    },
    {
      name: NET,
      width: 13,
      format: RUPEES,
      value: (day) => day.salesRupees,
      total: 'sum',
    },
    {
      name: 'GST',
      width: 11,
      format: RUPEES,
      value: (day) => day.gstRupees,
      total: 'sum',
    },
    ...(narrowed
      ? []
      : [
          {
            name: 'Delivery',
            width: 11,
            format: RUPEES,
            value: (day: SalesDay) => day.deliveryRupees ?? 0,
            total: 'sum' as const,
          },
        ]),
    {
      name: narrowed ? 'Paid for these' : 'Paid',
      width: 13,
      format: RUPEES,
      value: (day) => day.paidRupees,
      total: 'sum',
    },
    {
      name: 'Orders refunded',
      width: 10,
      format: COUNT,
      value: (day) => day.refundedOrders,
      total: 'sum',
    },
    {
      name: 'Refunds',
      width: 12,
      format: RUPEES,
      value: (day) => day.refundedRupees,
      total: 'sum',
    },
  ];
  return tableSheet(
    book,
    'Sales by day',
    input,
    'Sales by day',
    READING,
    columns,
    input.days,
    'No days in this period.',
  );
}

const brandName = (brand: { name: string | null; recorded: boolean }) =>
  brand.name ?? (brand.recorded ? 'No brand' : NOT_RECORDED);

function productSheet(book: Workbook, input: SalesWorkbookInput): Table {
  type Product = SalesDetail['products'][number];
  const products = input.detail.products;
  return tableSheet<Product>(
    book,
    'Products',
    input,
    'Sales by product',
    READING,
    [
      { name: 'Product', width: 32, value: (product) => product.name },
      {
        name: 'Category',
        width: 18,
        value: (product) => product.categoryName ?? NOT_RECORDED,
      },
      {
        name: 'Subcategory',
        width: 18,
        value: (product) => product.subcategoryName ?? '',
      },
      {
        name: 'Brand',
        width: 16,
        value: (product) =>
          brandName({ name: product.brandName, recorded: product.recorded }),
      },
      ...sold<Product>(),
      ...comparing(products),
    ],
    products,
    'Nothing was sold in this period or the one before.',
  );
}

// Each SKU's lines in the register: what it sold and what went back, named
// as it last sold.
interface PackSize extends Omit<GroupFigures, 'previousSalesRupees'> {
  sku: string;
  name: string;
  categoryName: string | null;
  subcategoryName: string | null;
  brandName: string | null;
  gstRate: number;
}
function packSizesOf(register: RegisterLine[]): PackSize[] {
  const found = new Map<string, PackSize>();
  for (const line of register) {
    if (!line.product) {
      continue;
    }
    const size = found.get(line.product.sku) ?? {
      sku: line.product.sku,
      name: '',
      categoryName: null,
      subcategoryName: null,
      brandName: null,
      gstRate: 0,
      soldPacks: 0,
      refundedPacks: 0,
      grossRupees: 0,
      refundRupees: 0,
      salesRupees: 0,
      gstRupees: 0,
    };
    // The register is oldest first: the last line names it.
    Object.assign(size, {
      name: line.product.name,
      categoryName: line.product.categoryName,
      subcategoryName: line.product.subcategoryName,
      brandName: line.product.brandName,
      gstRate: line.product.gstRate,
    });
    if (line.kind === 'SALE') {
      size.soldPacks += line.packs;
      size.grossRupees += line.priceRupees;
    } else {
      size.refundedPacks -= line.packs;
      size.refundRupees -= line.priceRupees;
    }
    size.salesRupees += line.priceRupees;
    size.gstRupees += line.gstRupees;
    found.set(line.product.sku, size);
  }
  return [...found.values()].sort(
    (a, b) => b.salesRupees - a.salesRupees || a.sku.localeCompare(b.sku),
  );
}

function packSizeSheet(
  book: Workbook,
  input: SalesWorkbookInput,
  sizes: PackSize[],
): Table {
  const total = sum(sizes, (size) => size.salesRupees);
  return tableSheet<PackSize>(
    book,
    'Pack sizes',
    input,
    'Sales by pack size (SKU)',
    `${READING} From the sales register: this period only.`,
    [
      { name: 'SKU', width: 16, value: (size) => size.sku },
      { name: 'Product', width: 30, value: (size) => size.name },
      {
        name: 'Category',
        width: 18,
        value: (size) => size.categoryName ?? NOT_RECORDED,
      },
      {
        name: 'Subcategory',
        width: 18,
        value: (size) => size.subcategoryName ?? '',
      },
      {
        name: 'Brand',
        width: 16,
        value: (size) =>
          brandName({
            name: size.brandName,
            recorded: size.categoryName !== null,
          }),
      },
      {
        name: 'GST rate',
        width: 8,
        format: RATE,
        value: (size) => size.gstRate,
      },
      ...sold<PackSize>(),
      {
        name: 'Share of net sales',
        width: 11,
        format: SHARE,
        value: (size) => (total > 0 ? size.salesRupees / total : null),
        total: 'sum',
      },
    ],
    sizes,
    'Nothing was sold in this period.',
  );
}

function categorySheets(
  book: Workbook,
  input: SalesWorkbookInput,
): { categories: Table; subcategories: Table } {
  type Category = SalesDetail['categories'][number];
  type Subcategory = SalesDetail['subcategories'][number];
  const { categories, subcategories } = input.detail;
  const empty = 'Nothing was sold in this period or the one before.';
  return {
    categories: tableSheet<Category>(
      book,
      'Categories',
      input,
      'Sales by category',
      `${READING} A category's sales include its subcategories'.`,
      [
        {
          name: 'Category',
          width: 24,
          value: (category) => category.name ?? NOT_RECORDED,
        },
        productsSold<Category>(),
        ...sold<Category>(),
        ...comparing(categories),
      ],
      categories,
      empty,
    ),
    subcategories: tableSheet<Subcategory>(
      book,
      'Subcategories',
      input,
      'Sales by subcategory',
      `${READING} Each category's subcategories, and what sold in it directly, add up to it.`,
      [
        {
          name: 'Category',
          width: 22,
          value: (subcategory) => subcategory.categoryName ?? NOT_RECORDED,
        },
        {
          name: 'Subcategory',
          width: 24,
          value: (subcategory) =>
            subcategory.subcategoryId !== null
              ? (subcategory.name ?? NOT_RECORDED)
              : subcategory.categoryId !== null
                ? 'Not in a subcategory'
                : '',
        },
        productsSold<Subcategory>(),
        ...sold<Subcategory>(),
        ...comparing(subcategories),
      ],
      subcategories,
      empty,
    ),
  };
}

function brandSheet(book: Workbook, input: SalesWorkbookInput): Table {
  type Brand = SalesDetail['brands'][number];
  const { brands } = input.detail;
  return tableSheet<Brand>(
    book,
    'Brands',
    input,
    'Sales by brand',
    READING,
    [
      { name: 'Brand', width: 22, value: brandName },
      productsSold<Brand>(),
      ...sold<Brand>(),
      ...comparing(brands),
    ],
    brands,
    'Nothing was sold in this period or the one before.',
  );
}

// A state's or a payment method's orders and what they came to.
function placeColumns<T extends PlaceFigures>(
  narrowed: boolean,
  items: T[],
): Column<T>[] {
  return [
    {
      name: 'Orders',
      width: 9,
      format: COUNT,
      value: (item) => item.orders,
      total: 'sum',
    },
    {
      name: 'Gross sales',
      width: 13,
      format: RUPEES,
      value: (item) => item.grossRupees,
      total: 'sum',
    },
    {
      name: 'Refunds',
      width: 12,
      format: RUPEES,
      value: (item) => item.refundRupees,
      total: 'sum',
    },
    {
      name: NET,
      width: 13,
      format: RUPEES,
      value: (item) => item.salesRupees,
      total: 'sum',
    },
    {
      name: 'GST',
      width: 11,
      format: RUPEES,
      value: (item) => item.gstRupees,
      total: 'sum',
    },
    ...(narrowed
      ? []
      : [
          {
            name: 'Delivery',
            width: 11,
            format: RUPEES,
            value: (item: T) => item.deliveryRupees ?? 0,
            total: 'sum' as const,
          },
        ]),
    {
      name: narrowed
        ? 'Paid for these (with GST)'
        : 'Paid (with GST and delivery)',
      width: 14,
      format: RUPEES,
      value: (item) => item.paidRupees,
      total: 'sum',
    },
    ...comparing(items),
  ];
}

function placeSheets(
  book: Workbook,
  input: SalesWorkbookInput,
): { states: Table; methods: Table } {
  type State = SalesDetail['states'][number];
  type Method = SalesDetail['methods'][number];
  const narrowed = isNarrowed(input.report.filters);
  const { states, methods } = input.detail;
  const empty = 'Nothing was sold in this period or the one before.';
  return {
    states: tableSheet<State>(
      book,
      'States',
      input,
      'Sales by state delivered to',
      READING,
      [
        { name: 'State', width: 22, value: (state) => state.state },
        ...placeColumns(narrowed, states),
      ],
      states,
      empty,
    ),
    methods: tableSheet<Method>(
      book,
      'Payment methods',
      input,
      'Sales by payment method',
      READING,
      [
        {
          name: 'Payment method',
          width: 18,
          value: (method) =>
            method.method ? METHOD_NAMES[method.method] : NOT_RECORDED,
        },
        ...placeColumns(narrowed, methods),
      ],
      methods,
      empty,
    ),
  };
}

function typeName(line: RegisterLine): string {
  if (line.product === null) {
    return line.kind === 'SALE' ? 'Delivery charge' : 'Delivery refunded';
  }
  return line.kind === 'SALE' ? 'Sale' : 'Refund';
}

function registerSheet(book: Workbook, input: SalesWorkbookInput) {
  tableSheet<RegisterLine>(
    book,
    'Sales register',
    input,
    'Sales register',
    'Each line sold or refunded, at its time in India, oldest first: refunds below 0, each order’s delivery charge on its own line. Filter or sort with the buttons on the header row: the Total row adds up the rows shown.',
    [
      {
        name: 'Date and time (India)',
        width: 18,
        format: MOMENT,
        value: (line) => indiaDate(line.at),
      },
      { name: 'Type', width: 16, value: typeName },
      { name: 'Order', width: 13, value: (line) => line.reference },
      { name: 'Product', width: 30, value: (line) => line.product?.name ?? '' },
      { name: 'SKU', width: 14, value: (line) => line.product?.sku ?? '' },
      {
        name: 'Category',
        width: 18,
        value: (line) =>
          line.product?.categoryName ?? (line.product ? NOT_RECORDED : ''),
      },
      {
        name: 'Subcategory',
        width: 18,
        value: (line) => line.product?.subcategoryName ?? '',
      },
      {
        name: 'Brand',
        width: 16,
        value: (line) =>
          line.product
            ? brandName({
                name: line.product.brandName,
                recorded: line.product.categoryName !== null,
              })
            : '',
      },
      { name: 'State', width: 16, value: (line) => line.state },
      {
        name: 'Payment method',
        width: 14,
        value: (line) =>
          line.method ? METHOD_NAMES[line.method] : NOT_RECORDED,
      },
      {
        name: 'Packs',
        width: 8,
        format: COUNT,
        value: (line) => (line.product ? line.packs : null),
        total: 'sum',
      },
      {
        name: 'Price without GST',
        width: 13,
        format: RUPEES,
        value: (line) => line.priceRupees,
        total: 'sum',
      },
      {
        name: 'GST rate',
        width: 8,
        format: RATE,
        value: (line) => (line.product ? line.product.gstRate : null),
      },
      {
        name: 'GST',
        width: 11,
        format: RUPEES,
        value: (line) => line.gstRupees,
        total: 'sum',
      },
      {
        name: 'Total',
        width: 13,
        format: RUPEES,
        value: (line) => line.totalRupees,
        total: 'sum',
      },
    ],
    input.register,
    'Nothing was sold or refunded in this period.',
  );
}

interface Tile {
  label: string;
  format: string;
  before: string;
  pick: (totals: SalesTotals) => number | null;
  none: string;
}

// A headline figure in a box three columns wide: its name, its figure, and
// the period before's beside the change.
function tile(
  sheet: Worksheet,
  top: number,
  left: number,
  figure: Tile,
  report: SalesReport,
) {
  const now = figure.pick(report.totals);
  const before = figure.pick(report.previousTotals);
  sheet.mergeCells(top, left, top, left + 2);
  sheet.mergeCells(top + 1, left, top + 1, left + 2);
  sheet.mergeCells(top + 2, left, top + 2, left + 1);
  const name = sheet.getCell(top, left);
  name.value = figure.label;
  name.font = { bold: true, size: 10, color: { argb: MUTED } };
  const value = sheet.getCell(top + 1, left);
  value.value = now ?? figure.none;
  value.numFmt = figure.format;
  value.font = { bold: true, size: 18 };
  value.alignment = { horizontal: 'left', vertical: 'middle' };
  const was = sheet.getCell(top + 2, left);
  was.value = before;
  was.numFmt = figure.before;
  was.font = { size: 9, color: { argb: MUTED } };
  was.alignment = { horizontal: 'left' };
  const change = sheet.getCell(top + 2, left + 2);
  change.value = changeOf(now, before);
  change.numFmt = TILE_CHANGE;
  change.font = { bold: true, size: 9, color: { argb: MUTED } };
  change.alignment = { horizontal: 'right' };
  const edge = { style: 'thin' as const, color: { argb: EDGE } };
  for (let row = top; row <= top + 2; row += 1) {
    for (let column = left; column <= left + 2; column += 1) {
      const cell = sheet.getCell(row, column);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: PALE },
      };
      cell.border = {
        ...(row === top ? { top: edge } : {}),
        ...(row === top + 2 ? { bottom: edge } : {}),
        ...(column === left ? { left: edge } : {}),
        ...(column === left + 2 ? { right: edge } : {}),
      };
    }
  }
  sheet.getRow(top + 1).height = 28;
}

interface Charted {
  days: Table;
  products: Table;
  categories: Table;
  brands: Table;
  states: Table;
  methods: Table;
  packSizes: Table;
}

// The first sheet: what the period came to, and a chart of each grouping
// from its sheet.
function dashboard(
  sheet: Worksheet,
  input: SalesWorkbookInput,
  tables: Charted,
  sizes: PackSize[],
): SheetChart[] {
  const { report, detail } = input;
  const narrowed = isNarrowed(report.filters);
  sheet.columns = [
    { width: 2 },
    ...Array.from({ length: 12 }, () => ({ width: 13 })),
  ];
  sheet.getCell('B1').value = 'Sales report';
  sheet.getCell('B1').font = { bold: true, size: 18 };
  sheet.getCell('B2').value = `Herbal Commerce · ${periodName(
    report.period,
  )}, compared with ${periodName(report.previousPeriod)}`;
  sheet.getCell('B2').font = { color: { argb: MUTED } };
  sheet.getCell('B3').value = safeText(
    `${narrowedName(report.filters)} · ${
      report.refreshedAt
        ? `figures as of ${momentName(report.refreshedAt)} India time`
        : 'figures not yet worked out'
    } · prepared by ${input.preparedBy}`,
  );
  sheet.getCell('B3').font = { color: { argb: MUTED } };

  const rupees = { format: RUPEES, before: BEFORE_RUPEES, none: '' };
  const count = { format: COUNT, before: BEFORE_COUNT, none: '' };
  const tiles: Tile[] = [
    { ...rupees, label: 'Net sales (without GST)', pick: (t) => t.salesRupees },
    { ...rupees, label: 'GST', pick: (t) => t.gstRupees },
    {
      ...rupees,
      label: narrowed ? 'Paid for these' : 'Paid in all',
      pick: (t) => t.paidRupees,
    },
    { ...count, label: 'Orders', pick: (t) => t.orders },
    {
      ...rupees,
      label: 'Average order',
      pick: (t) => t.averageOrderRupees,
      none: 'No orders',
    },
    { ...rupees, label: 'Refunds', pick: (t) => t.refundedRupees },
    { ...count, label: 'New customers', pick: (t) => t.newCustomers },
    {
      ...count,
      label: 'Returning customers',
      pick: (t) => t.returningCustomers,
    },
  ];
  tiles.forEach((figure, i) => {
    tile(sheet, i < 4 ? 5 : 9, 2 + (i % 4) * 3, figure, report);
  });
  sheet.getCell('B13').value =
    'Each chart reads its sheet: filter a sheet with the buttons on its header row and its chart shows only the rows left.';
  sheet.getCell('B13').font = { size: 9, color: { argb: MUTED } };

  // The places: full width for the days, then two to a row. Columns and
  // rows counted from 0.
  const HEIGHT = 17;
  const top = 14;
  const at = (slot: number) => {
    const row = slot === 0 ? top : top + (HEIGHT + 1) * Math.ceil(slot / 2);
    const left = slot === 0 || slot % 2 === 1;
    return {
      from: { column: left ? 1 : 7, row },
      to: { column: slot === 0 || !left ? 13 : 7, row: row + HEIGHT },
    };
  };
  const charts: SheetChart[] = [];
  const ranked = <T>(
    slot: number,
    title: string,
    sheetName: string,
    table: Table,
    items: T[],
    labelColumn: string,
    label: (item: T) => string,
    value: (item: T) => number,
  ) => {
    const shown = items.slice(0, 10);
    const place = at(slot);
    if (shown.length === 0) {
      const cell = sheet.getCell(place.from.row + 1, place.from.column + 1);
      cell.value = `${title}: nothing sold in this period.`;
      cell.font = { color: { argb: MUTED } };
      return;
    }
    charts.push({
      title,
      description: `${title}, from the ${sheetName} sheet, as a bar chart of net sales.`,
      kind: 'bars',
      sheet: sheetName,
      first: table.first,
      last: table.first + shown.length - 1,
      labelColumn: table.letters.get(labelColumn) ?? 'A',
      valueColumn: table.letters.get(NET) ?? 'B',
      labels: shown.map((item) => safeText(label(item))),
      values: shown.map(value),
      valueName: NET,
      valueFormat: RUPEES,
      ...place,
    });
  };

  if (input.days.length > 0) {
    charts.push({
      title: 'Net sales by day',
      description:
        'Net sales of each day of the period, from the Sales by day sheet, as a column chart.',
      kind: 'columns',
      sheet: 'Sales by day',
      first: tables.days.first,
      last: tables.days.last,
      labelColumn: 'A',
      valueColumn: tables.days.letters.get(NET) ?? 'D',
      labels: input.days.map((day) => daySerial(day.day)),
      labelFormat: 'd mmm',
      values: input.days.map((day) => day.salesRupees),
      valueName: NET,
      valueFormat: RUPEES,
      ...at(0),
    });
  }
  const net = (item: { salesRupees: number }) => item.salesRupees;
  ranked(
    1,
    'Top 10 products',
    'Products',
    tables.products,
    detail.products,
    'Product',
    (product) => product.name,
    net,
  );
  ranked(
    2,
    'Net sales by category',
    'Categories',
    tables.categories,
    detail.categories,
    'Category',
    (category) => category.name ?? NOT_RECORDED,
    net,
  );
  ranked(
    3,
    'Top 10 brands',
    'Brands',
    tables.brands,
    detail.brands,
    'Brand',
    brandName,
    net,
  );
  ranked(
    4,
    'Top 10 states',
    'States',
    tables.states,
    detail.states,
    'State',
    (state) => state.state,
    net,
  );
  ranked(
    5,
    'Net sales by payment method',
    'Payment methods',
    tables.methods,
    detail.methods,
    'Payment method',
    (method) => (method.method ? METHOD_NAMES[method.method] : NOT_RECORDED),
    net,
  );
  ranked(
    6,
    'Top 10 pack sizes (SKU)',
    'Pack sizes',
    tables.packSizes,
    sizes,
    'SKU',
    (size) => size.sku,
    net,
  );
  return charts;
}

export async function salesWorkbook(
  input: SalesWorkbookInput,
): Promise<Buffer> {
  const book = new Workbook();
  book.creator = 'Herbal Commerce';
  book.created = input.preparedAt;
  // The totals' formulas are worked out again as the file opens: a result
  // of 0 is not kept in the file.
  book.calcProperties.fullCalcOnLoad = true;
  // First, though filled last: its charts read the sheets after it.
  const first = book.addWorksheet('Dashboard', {
    views: [{ showGridLines: false }],
    pageSetup: PRINTED,
    properties: { tabColor: { argb: GREEN } },
  });
  summarySheet(book, input);
  const days = daySheet(book, input);
  const products = productSheet(book, input);
  const sizes = packSizesOf(input.register);
  const packSizes = packSizeSheet(book, input, sizes);
  const { categories } = categorySheets(book, input);
  const brands = brandSheet(book, input);
  const { states, methods } = placeSheets(book, input);
  registerSheet(book, input);
  const charts = dashboard(
    first,
    input,
    { days, products, categories, brands, states, methods, packSizes },
    sizes,
  );
  return withCharts(
    Buffer.from(await book.xlsx.writeBuffer()),
    'Dashboard',
    charts,
  );
}
