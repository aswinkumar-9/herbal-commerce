import { BadRequestException } from '@nestjs/common';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SalesExportService, TOO_MANY_LINES } from './sales-export.service';
import type { SalesReport, SalesReportService } from './sales-report.service';

const NOTHING = {
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
const REPORT = {
  period: { from: '2026-11-20', to: '2026-11-21' },
  filters: {
    product: null,
    category: null,
    brand: null,
    state: null,
    method: null,
  },
  previousPeriod: { from: '2026-11-18', to: '2026-11-19' },
  refreshedAt: null,
  totals: NOTHING,
  previousTotals: NOTHING,
  series: { unit: 'day', points: [] },
  products: [],
  categories: [],
  brands: [],
  states: [],
  methods: [],
} as unknown as SalesReport;
const CONTEXT = { actorId: 'staff-2', ip: '203.0.113.7', requestId: 'req-1' };
const PERIOD = { from: '2026-11-20', to: '2026-11-21' };

const NO_DETAIL = {
  products: [],
  categories: [],
  subcategories: [],
  brands: [],
  states: [],
  methods: [],
};

function setup(
  found: unknown = {
    report: REPORT,
    days: [],
    detail: NO_DETAIL,
    register: [],
  },
) {
  const reports = { forExport: jest.fn().mockResolvedValue(found) };
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ fullName: 'Ravi Kumar' }),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const exports = new SalesExportService(
    reports as unknown as SalesReportService,
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { exports, reports, prisma, audit };
}

describe('SalesExportService.salesWorkbook', () => {
  it('makes the Excel file, named for its period, and writes who took it to the audit log', async () => {
    const { exports, reports, prisma, audit } = setup();

    const { fileName, file } = await exports.salesWorkbook(
      { ...PERIOD, productId: 'p1', categoryId: undefined },
      CONTEXT,
    );
    expect(reports.forExport).toHaveBeenCalledWith({
      ...PERIOD,
      productId: 'p1',
      categoryId: undefined,
    });
    expect(fileName).toBe(
      'herbal-commerce-sales-2026-11-20-to-2026-11-21.xlsx',
    );
    // An .xlsx is a zip.
    expect(file.subarray(0, 2).toString()).toBe('PK');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'staff-2' },
      select: { fullName: true },
    });
    expect(audit.record).toHaveBeenCalledWith(prisma, {
      ...CONTEXT,
      action: 'report.sales_exported',
      targetType: 'report',
      after: {
        from: '2026-11-20',
        to: '2026-11-21',
        productId: 'p1',
        registerLines: 0,
      },
    });
  });

  it('writes a state and a way of paying it was narrowed to', async () => {
    const { exports, audit } = setup();

    await exports.salesWorkbook(
      { ...PERIOD, state: 'Kerala', method: 'NOT_RECORDED' },
      CONTEXT,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: {
          from: '2026-11-20',
          to: '2026-11-21',
          state: 'Kerala',
          method: 'NOT_RECORDED',
          registerLines: 0,
        },
      }),
    );
  });

  it('refuses a period with too many lines for one file, and writes nothing', async () => {
    const { exports, audit } = setup(null);

    const refused = exports.salesWorkbook(PERIOD, CONTEXT);
    await expect(refused).rejects.toBeInstanceOf(BadRequestException);
    await expect(refused).rejects.toThrow(TOO_MANY_LINES);
    expect(TOO_MANY_LINES).toBe(
      'More than 1,00,000 lines were sold or refunded in this period: download a shorter one',
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('names the preparer as a Super User when the account is gone', async () => {
    const { exports, prisma } = setup();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(exports.salesWorkbook(PERIOD, CONTEXT)).resolves.toMatchObject(
      { fileName: expect.any(String) },
    );
  });
});
