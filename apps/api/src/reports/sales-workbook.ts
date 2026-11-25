import { Workbook } from 'exceljs';
import type { Row, Worksheet } from 'exceljs';
import type { PaymentMethod } from '../generated/prisma/enums';
import type {
  RegisterLine,
  SalesDay,
  SalesFilters,
  SalesReport,
  SalesTotals,
} from './sales-report.service';

// The sales report as an Excel workbook (part 15D, ADR 0047), as a
// company's sales report reads: a summary beside the period before, each
// day, each grouping, and the register of every line sold or refunded.
// GST invoice numbers and the CGST, SGST and IGST split wait until the
// company is registered (ADR 0026).

export interface SalesWorkbookInput {
  report: SalesReport;
  days: SalesDay[];
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
const SHARE = '0%;-0%';
const DAY = 'dd mmm yyyy';
const MOMENT = 'dd mmm yyyy hh:mm';
const RATE = '0"%"';

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

// A table's header: bold on a pale fill, ruled under, kept in view while
// the rows scroll.
function header(sheet: Worksheet, row: Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8F1EB' },
    };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF8AA595' } } };
  });
  sheet.views = [{ state: 'frozen', ySplit: row.number }];
}

// A totals row under a table: SUM formulas, with their results written in
// too, so the file reads right before Excel works them out.
function totals(
  sheet: Worksheet,
  first: number,
  sums: Record<string, number>,
  label = 'Total',
) {
  const last = sheet.rowCount;
  const row = sheet.addRow([]);
  row.getCell(1).value = label;
  for (const [column, result] of Object.entries(sums)) {
    row.getCell(column).value = {
      formula: `SUM(${column}${first}:${column}${last})`,
      result,
    };
  }
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.border = { top: { style: 'thin', color: { argb: 'FF8AA595' } } };
  });
}

const sum = <T>(items: T[], pick: (item: T) => number) =>
  items.reduce((total, item) => total + pick(item), 0);

interface Figure {
  label: string;
  format: string;
  pick: (totals: SalesTotals) => number | null;
  // What a figure that has none says.
  none: string;
}

function summarySheet(book: Workbook, input: SalesWorkbookInput) {
  const { report } = input;
  const narrowed = isNarrowed(report.filters);
  const sheet = book.addWorksheet('Summary', {
    views: [{ showGridLines: false }],
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

  const figures: Figure[] = [
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
  header(
    sheet,
    sheet.addRow([
      'Figure',
      'This period',
      'Period before',
      'Change',
      'Change (%)',
    ]),
  );
  sheet.views = [{ showGridLines: false }];
  for (const figure of figures) {
    const now = figure.pick(report.totals);
    const before = figure.pick(report.previousTotals);
    const row = sheet.addRow([
      figure.label,
      now ?? figure.none,
      before ?? figure.none,
      now !== null && before !== null ? now - before : null,
      // A share of 0, of less, or down past 0 means nothing.
      now !== null && before !== null && before > 0 && now >= 0
        ? (now - before) / before
        : null,
    ]);
    for (const column of [2, 3, 4]) {
      row.getCell(column).numFmt = figure.format;
    }
    row.getCell(5).numFmt = SHARE;
  }
  sheet.addRow([]);
  sheet.addRow(['Notes']).font = { bold: true };
  for (const note of [
    'Sales are what the products sold for, without the GST in their prices, less what was refunded.',
    'A payment counts on the day in India it was paid; a refund comes off on the day it was made.',
    'Each period is compared with the one of the same length just before it.',
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

function daySheet(book: Workbook, input: SalesWorkbookInput) {
  const narrowed = isNarrowed(input.report.filters);
  const sheet = book.addWorksheet('Sales by day');
  const columns = [
    { name: 'Date', width: 14, format: DAY },
    { name: 'Orders', width: 10, format: COUNT },
    { name: 'Sales', width: 14, format: RUPEES },
    { name: 'GST', width: 12, format: RUPEES },
    ...(narrowed ? [] : [{ name: 'Delivery', width: 12, format: RUPEES }]),
    { name: narrowed ? 'Paid for these' : 'Paid', width: 14, format: RUPEES },
    { name: 'Orders refunded', width: 16, format: COUNT },
    { name: 'Refunds', width: 12, format: RUPEES },
  ];
  sheet.columns = columns.map((column) => ({ width: column.width }));
  header(sheet, sheet.addRow(columns.map((column) => column.name)));
  const values = (day: SalesDay) => [
    dayDate(day.day),
    day.orders,
    day.salesRupees,
    day.gstRupees,
    ...(narrowed ? [] : [day.deliveryRupees ?? 0]),
    day.paidRupees,
    day.refundedOrders,
    day.refundedRupees,
  ];
  for (const day of input.days) {
    const row = sheet.addRow(values(day));
    columns.forEach((column, i) => {
      row.getCell(i + 1).numFmt = column.format;
    });
  }
  const letters = 'BCDEFGH';
  const sums: Record<string, number> = {};
  columns.slice(1).forEach((_, i) => {
    sums[letters[i] ?? 'B'] = sum(input.days, (day) => {
      const value = values(day)[i + 1];
      return typeof value === 'number' ? value : 0;
    });
  });
  totals(sheet, 2, sums);
  sheet.getRow(sheet.rowCount).eachCell((cell, column) => {
    if (column > 1) {
      cell.numFmt = columns[column - 1]?.format ?? COUNT;
    }
  });
}

// A grouping: its name, maybe its orders or packs, and its sales.
function listSheet(
  book: Workbook,
  name: string,
  columns: { name: string; width: number; format?: string }[],
  rows: (string | number)[][],
  totalled: boolean,
) {
  const sheet = book.addWorksheet(name);
  sheet.columns = columns.map((column) => ({ width: column.width }));
  header(sheet, sheet.addRow(columns.map((column) => column.name)));
  for (const values of rows) {
    const row = sheet.addRow(
      values.map((value) =>
        typeof value === 'string' ? safeText(value) : value,
      ),
    );
    columns.forEach((column, i) => {
      if (column.format) {
        row.getCell(i + 1).numFmt = column.format;
      }
    });
  }
  if (totalled) {
    const letters = 'ABCDEFGH';
    const sums: Record<string, number> = {};
    columns.forEach((column, i) => {
      if (column.format) {
        sums[letters[i] ?? 'A'] = sum(rows, (row) => {
          const value = row[i];
          return typeof value === 'number' ? value : 0;
        });
      }
    });
    totals(sheet, 2, sums);
    sheet.getRow(sheet.rowCount).eachCell((cell, column) => {
      const format = columns[column - 1]?.format;
      if (format) {
        cell.numFmt = format;
      }
    });
  }
  return sheet;
}

function groupingSheets(book: Workbook, { report }: SalesWorkbookInput) {
  listSheet(
    book,
    'By product',
    [
      { name: 'Product', width: 36 },
      { name: 'Packs', width: 10, format: COUNT },
      { name: 'Sales', width: 14, format: RUPEES },
    ],
    report.products.map((product) => [
      product.name,
      product.packs,
      product.salesRupees,
    ]),
    true,
  );

  // A category's sales include its subcategories': its own row says "All",
  // so the rows never add up twice.
  const categories = listSheet(
    book,
    'By category',
    [
      { name: 'Category', width: 28 },
      { name: 'Subcategory', width: 28 },
      { name: 'Sales', width: 14, format: RUPEES },
    ],
    report.categories.flatMap((category) => [
      [category.name ?? NOT_RECORDED, 'All', category.salesRupees],
      ...category.subcategories.map((subcategory) => [
        category.name ?? NOT_RECORDED,
        subcategory.name,
        subcategory.salesRupees,
      ]),
    ]),
    false,
  );
  categories.eachRow((row, number) => {
    if (number > 1 && row.getCell(2).value === 'All') {
      row.font = { bold: true };
    }
  });

  listSheet(
    book,
    'By brand',
    [
      { name: 'Brand', width: 28 },
      { name: 'Sales', width: 14, format: RUPEES },
    ],
    report.brands.map((brand) => [
      brand.name ?? (brand.recorded ? 'No brand' : NOT_RECORDED),
      brand.salesRupees,
    ]),
    true,
  );
  listSheet(
    book,
    'By state',
    [
      { name: 'State', width: 24 },
      { name: 'Orders', width: 10, format: COUNT },
      { name: 'Sales', width: 14, format: RUPEES },
    ],
    report.states.map((state) => [
      state.state,
      state.orders,
      state.salesRupees,
    ]),
    true,
  );
  listSheet(
    book,
    'By payment method',
    [
      { name: 'Payment method', width: 20 },
      { name: 'Orders', width: 10, format: COUNT },
      { name: 'Sales', width: 14, format: RUPEES },
    ],
    report.methods.map((method) => [
      method.method ? METHOD_NAMES[method.method] : NOT_RECORDED,
      method.orders,
      method.salesRupees,
    ]),
    true,
  );
}

const REGISTER_COLUMNS = [
  { name: 'Date and time (India)', width: 20, format: MOMENT },
  { name: 'Type', width: 18 },
  { name: 'Order', width: 14 },
  { name: 'Product', width: 32 },
  { name: 'SKU', width: 14 },
  { name: 'Category', width: 20 },
  { name: 'Subcategory', width: 20 },
  { name: 'Brand', width: 18 },
  { name: 'State', width: 18 },
  { name: 'Payment method', width: 16 },
  { name: 'Packs', width: 8, format: COUNT },
  { name: 'Price without GST', width: 18, format: RUPEES },
  { name: 'GST rate', width: 10, format: RATE },
  { name: 'GST', width: 12, format: RUPEES },
  { name: 'Total', width: 14, format: RUPEES },
];

function typeName(line: RegisterLine): string {
  if (line.product === null) {
    return line.kind === 'SALE' ? 'Delivery charge' : 'Delivery refunded';
  }
  return line.kind === 'SALE' ? 'Sale' : 'Refund';
}

function registerSheet(book: Workbook, { register }: SalesWorkbookInput) {
  const sheet = book.addWorksheet('Sales register');
  sheet.columns = REGISTER_COLUMNS.map((column) => ({ width: column.width }));
  const top = sheet.addRow(REGISTER_COLUMNS.map((column) => column.name));
  header(sheet, top);
  if (register.length === 0) {
    sheet.addRow(['Nothing was sold or refunded in this period.']);
    return;
  }
  for (const line of register) {
    const row = sheet.addRow([
      indiaDate(line.at),
      typeName(line),
      line.reference,
      safeText(line.product?.name ?? ''),
      safeText(line.product?.sku ?? ''),
      safeText(
        line.product?.categoryName ?? (line.product ? NOT_RECORDED : ''),
      ),
      safeText(line.product?.subcategoryName ?? ''),
      safeText(line.product?.brandName ?? ''),
      safeText(line.state),
      line.method ? METHOD_NAMES[line.method] : NOT_RECORDED,
      line.product ? line.packs : null,
      line.priceRupees,
      line.product ? line.product.gstRate : null,
      line.gstRupees,
      line.totalRupees,
    ]);
    REGISTER_COLUMNS.forEach((column, i) => {
      if (column.format) {
        row.getCell(i + 1).numFmt = column.format;
      }
    });
  }
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: sheet.rowCount, column: REGISTER_COLUMNS.length },
  };
  totals(sheet, 2, {
    K: sum(register, (line) => line.packs),
    L: sum(register, (line) => line.priceRupees),
    N: sum(register, (line) => line.gstRupees),
    O: sum(register, (line) => line.totalRupees),
  });
  const last = sheet.getRow(sheet.rowCount);
  for (const [column, format] of [
    ['K', COUNT],
    ['L', RUPEES],
    ['N', RUPEES],
    ['O', RUPEES],
  ] as const) {
    last.getCell(column).numFmt = format;
  }
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
  summarySheet(book, input);
  daySheet(book, input);
  groupingSheets(book, input);
  registerSheet(book, input);
  return Buffer.from(await book.xlsx.writeBuffer());
}
