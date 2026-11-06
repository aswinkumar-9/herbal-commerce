// The rules of stock (ADR 0024), as plain functions of a date, so they are
// easy to test.

// A batch is sold only while it has at least 6 months left before it
// expires: the owner's choice, so a customer always gets a pack with time
// to use it.
export const MIN_SHELF_LIFE_MONTHS = 6;

// Dates on labels, and "today", are Indian dates (IST, UTC+5:30).
const INDIA_OFFSET_MINUTES = 330;

export interface StockIssue {
  field: string;
  message: string;
}

// Today's date in India, at midnight UTC: the form in which the database's
// DATE columns arrive.
export function todayInIndia(now: Date): Date {
  const india = new Date(now.getTime() + INDIA_OFFSET_MINUTES * 60_000);
  return new Date(
    Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), india.getUTCDate()),
  );
}

// The same day some months later. A day the later month lacks becomes its
// last day: 31 August plus 6 months is the end of February.
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)),
  );
}

// The earliest expiry date that may still be sold today.
export function sellableFrom(now: Date): Date {
  return addMonths(todayInIndia(now), MIN_SHELF_LIFE_MONTHS);
}

// Whether a batch with this expiry date may be sold today.
export function isSellable(expiresOn: Date, now: Date): boolean {
  return expiresOn.getTime() >= sellableFrom(now).getTime();
}

// What stops a batch from having these dates: an expiry that is not after
// the manufacturing date, or a manufacturing date still to come. Empty when
// all is well. Checked on the batch as it will be saved.
export function batchDateIssues(
  batch: { manufacturedOn: Date; expiresOn: Date },
  now: Date,
): StockIssue[] {
  const issues: StockIssue[] = [];
  if (batch.manufacturedOn.getTime() > todayInIndia(now).getTime()) {
    issues.push({
      field: 'manufacturedOn',
      message: 'The manufacturing date cannot be in the future',
    });
  }
  if (batch.expiresOn.getTime() <= batch.manufacturedOn.getTime()) {
    issues.push({
      field: 'expiresOn',
      message: 'The expiry date must be after the manufacturing date',
    });
  }
  return issues;
}

// A batch that has expired by today cannot be received.
export function expiredIssues(expiresOn: Date, now: Date): StockIssue[] {
  return expiresOn.getTime() <= todayInIndia(now).getTime()
    ? [{ field: 'expiresOn', message: 'This batch has already expired' }]
    : [];
}
