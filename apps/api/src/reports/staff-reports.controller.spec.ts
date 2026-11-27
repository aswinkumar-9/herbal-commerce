import { RequestMethod } from '@nestjs/common';
import {
  HEADERS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { STAFF_ONLY } from '../auth/staff-only.decorator';
import { SUPER_USER_ONLY } from '../auth/super-user-only.decorator';
import type { CustomersReportService } from './customers-report.service';
import type { SalesExportService } from './sales-export.service';
import type { SalesReportService } from './sales-report.service';
import { StaffReportsController } from './staff-reports.controller';

describe('StaffReportsController', () => {
  it('serves a period’s customers at GET /v1/staff/reports/customers', async () => {
    const report = { totals: {} };
    const customers = { customers: jest.fn().mockResolvedValue(report) };
    const controller = new StaffReportsController(
      {} as SalesReportService,
      {} as SalesExportService,
      customers as unknown as CustomersReportService,
    );

    const period = {
      from: '2026-11-01',
      to: '2026-11-25',
      state: 'Kerala' as const,
    };
    await expect(controller.customers(period)).resolves.toBe(report);
    expect(customers.customers).toHaveBeenCalledWith(period);
    const handler = (
      StaffReportsController.prototype as unknown as Record<string, object>
    ).customers;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('customers');
  });

  it('serves a period’s sales at GET /v1/staff/reports/sales, for Super Users only, which takes staff tokens only', async () => {
    const report = { totals: {} };
    const reports = { sales: jest.fn().mockResolvedValue(report) };
    const controller = new StaffReportsController(
      reports as unknown as SalesReportService,
      {} as SalesExportService,
      {} as CustomersReportService,
    );

    const period = { from: '2026-11-01', to: '2026-11-25' };
    await expect(controller.sales(period)).resolves.toBe(report);
    expect(reports.sales).toHaveBeenCalledWith(period);

    const handler = (
      StaffReportsController.prototype as unknown as Record<string, object>
    ).sales;
    expect(Reflect.getMetadata(PATH_METADATA, StaffReportsController)).toBe(
      'staff/reports',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('sales');
    const reflector = new Reflector();
    expect(reflector.get(STAFF_ONLY, StaffReportsController)).toBe(true);
    expect(reflector.get(SUPER_USER_ONLY, StaffReportsController)).toBe(true);
  });

  it('gives the same as an Excel file at GET /v1/staff/reports/sales/export, never kept on the way', async () => {
    const file = Buffer.from('xlsx');
    const exports = {
      salesWorkbook: jest.fn().mockResolvedValue({
        fileName: 'herbal-commerce-sales-2026-11-01-to-2026-11-25.xlsx',
        file,
      }),
    };
    const controller = new StaffReportsController(
      {} as SalesReportService,
      exports as unknown as SalesExportService,
      {} as CustomersReportService,
    );
    const context = { actorId: 'staff-1', ip: '203.0.113.7', requestId: 'r1' };

    const period = { from: '2026-11-01', to: '2026-11-25' };
    const streamed = await controller.exportSales(period, context);
    expect(exports.salesWorkbook).toHaveBeenCalledWith(period, context);
    expect(streamed.getHeaders()).toEqual({
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition:
        'attachment; filename="herbal-commerce-sales-2026-11-01-to-2026-11-25.xlsx"',
      length: 4,
    });

    const handler = (
      StaffReportsController.prototype as unknown as Record<string, object>
    ).exportSales;
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('sales/export');
    expect(Reflect.getMetadata(HEADERS_METADATA, handler)).toEqual([
      { name: 'Cache-Control', value: 'no-store' },
    ]);
  });
});
