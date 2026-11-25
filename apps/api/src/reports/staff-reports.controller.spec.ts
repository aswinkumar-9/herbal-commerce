import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { STAFF_ONLY } from '../auth/staff-only.decorator';
import { SUPER_USER_ONLY } from '../auth/super-user-only.decorator';
import type { SalesReportService } from './sales-report.service';
import { StaffReportsController } from './staff-reports.controller';

describe('StaffReportsController', () => {
  it('serves a period’s sales at GET /v1/staff/reports/sales, for Super Users only, which takes staff tokens only', async () => {
    const report = { totals: {} };
    const reports = { sales: jest.fn().mockResolvedValue(report) };
    const controller = new StaffReportsController(
      reports as unknown as SalesReportService,
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
});
