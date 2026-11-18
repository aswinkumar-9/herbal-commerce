import { wholeNumber } from '../catalog/products/pack-size-form';
import { packs } from './stock-display';
import type {
  Batch,
  BatchFields,
  BatchLabel,
  CountFields,
  MovementFields,
} from './stock-api';

// The batch dialogs' rules: the same as the API's (ADR 0024, 0034), so most
// mistakes are caught before anything is sent. The API checks them again.

export const BATCH_NUMBER_MAX = 40;
export const NOTE_MAX = 200;
export const MAX_PACKS = 1_000_000;
// A batch sells while it has at least 6 months left.
const MIN_SHELF_LIFE_MONTHS = 6;
// Staff are told a batch stops selling soon this many days before.
const EXPIRING_SOON_DAYS = 30;
// Dates on labels, and "today", are Indian dates (IST, UTC+5:30).
const INDIA_OFFSET_MINUTES = 330;
const BATCH_NUMBER = /^[A-Z0-9][A-Z0-9/.-]*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The API's words when a pack size already has a batch with the number,
// so the console can mark the field.
export const BATCH_NUMBER_TAKEN =
  'This pack size already has a batch with this number.';

// As printed on the pack, with spaces dropped and letters made capitals:
// " ab 2611 " is "AB2611", as the API stores it.
export function tidyBatchNumber(text: string): string {
  return text.replace(/\s+/g, '').toUpperCase();
}

// Today in India, as a label day: 2026-11-18.
export function todayInIndia(now: Date): string {
  return new Date(now.getTime() + INDIA_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(0, 10);
}

// Whether text is a real day, such as 2028-02-29 (2027-02-29 is not).
export function isDay(text: string): boolean {
  if (!DAY.test(text)) {
    return false;
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

// The same day some months later. A day the later month lacks becomes its
// last day: 31 August plus 6 months is the end of February.
export function addMonths(day: string, months: number): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  const target = month - 1 + months;
  const lastDay = new Date(Date.UTC(year, target + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, target, Math.min(date, lastDay)))
    .toISOString()
    .slice(0, 10);
}

function daysFrom(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}

// Where a batch stands today: selling, selling but stopping within 30
// days, no longer sold (under 6 months left), or past its expiry date.
export type BatchState = 'selling' | 'soon' | 'stopped' | 'expired';

export function batchState(
  batch: Pick<Batch, 'sellable' | 'stopsSellingOn' | 'expiresOn'>,
  now: Date,
): BatchState {
  const today = todayInIndia(now);
  if (batch.expiresOn <= today) {
    return 'expired';
  }
  if (!batch.sellable) {
    return 'stopped';
  }
  return daysFrom(today, batch.stopsSellingOn) <= EXPIRING_SOON_DAYS
    ? 'soon'
    : 'selling';
}

// A batch with nothing in it and nothing held for orders.
export function isEmpty(batch: Batch): boolean {
  return (
    batch.quantity === 0 && batch.awaitingPacking === 0 && batch.packed === 0
  );
}

function batchNumberProblem(text: string): string | null {
  const number = tidyBatchNumber(text);
  if (!number) {
    return 'Enter the batch number';
  }
  if (number.length > BATCH_NUMBER_MAX) {
    return `A batch number has at most ${BATCH_NUMBER_MAX} characters`;
  }
  if (!BATCH_NUMBER.test(number)) {
    return 'A batch number has letters, digits, "/", "." and "-"';
  }
  return null;
}

// A number of packs as typed, or why it is not one.
function packsProblem(
  text: string,
  { empty, example, least }: { empty: string; example: string; least: 0 | 1 },
): string | null {
  if (!text.trim()) {
    return empty;
  }
  const value = wholeNumber(text);
  if (value === null) {
    return `A whole number of packs, like ${example}`;
  }
  if (value < least || value > MAX_PACKS) {
    return `Between ${least} and 10,00,000 packs`;
  }
  return null;
}

export type LabelField = 'batchNumber' | 'manufacturedOn' | 'expiresOn';

// A batch's label, as typed. Dates come from date boxes: 2028-09-30.
export interface LabelValues {
  batchNumber: string;
  manufacturedOn: string;
  expiresOn: string;
}

function labelProblems(
  values: LabelValues,
  now: Date,
): Partial<Record<LabelField, string>> {
  const errors: Partial<Record<LabelField, string>> = {};
  const number = batchNumberProblem(values.batchNumber);
  if (number) {
    errors.batchNumber = number;
  }
  const made = values.manufacturedOn;
  if (!made) {
    errors.manufacturedOn = 'Enter the manufacturing date';
  } else if (!isDay(made)) {
    errors.manufacturedOn = 'Use a date like 2026-10-31';
  } else if (made > todayInIndia(now)) {
    errors.manufacturedOn = 'The manufacturing date cannot be in the future';
  }
  const expires = values.expiresOn;
  if (!expires) {
    errors.expiresOn = 'Enter the expiry date';
  } else if (!isDay(expires)) {
    errors.expiresOn = 'Use a date like 2028-09-30';
  } else if (isDay(made) && expires <= made) {
    errors.expiresOn = 'The expiry date must be after the manufacturing date';
  }
  return errors;
}

// Receiving a delivery: a new batch with its label and packs.
export type ReceiveField = LabelField | 'quantity' | 'note';
// Top to bottom, as the dialog shows them.
export const RECEIVE_FIELDS: readonly ReceiveField[] = [
  'batchNumber',
  'manufacturedOn',
  'expiresOn',
  'quantity',
  'note',
];
export type ReceiveErrors = Partial<Record<ReceiveField, string>>;

export interface ReceiveValues extends LabelValues {
  quantity: string;
  note: string;
}

export const NEW_DELIVERY: ReceiveValues = {
  batchNumber: '',
  manufacturedOn: '',
  expiresOn: '',
  quantity: '',
  note: '',
};

export function checkReceive(values: ReceiveValues, now: Date): ReceiveErrors {
  const errors: ReceiveErrors = labelProblems(values, now);
  if (!errors.expiresOn && values.expiresOn <= todayInIndia(now)) {
    errors.expiresOn = 'This batch has already expired';
  }
  const quantity = packsProblem(values.quantity, {
    empty: 'Enter how many packs came',
    example: '120',
    least: 1,
  });
  if (quantity) {
    errors.quantity = quantity;
  }
  return errors;
}

// A batch with under 6 months left is never sold: staff are told before
// they receive one.
export function expiryHint(expiresOn: string, now: Date): string {
  if (!isDay(expiresOn) || expiresOn <= todayInIndia(now)) {
    return 'As printed on the label.';
  }
  return expiresOn < addMonths(todayInIndia(now), MIN_SHELF_LIFE_MONTHS)
    ? 'Under 6 months left: this batch will not be sold.'
    : 'As printed on the label.';
}

function noteOf(text: string): string | null {
  return text.trim() || null;
}

export function toBatchFields(values: ReceiveValues): BatchFields {
  return {
    batchNumber: tidyBatchNumber(values.batchNumber),
    manufacturedOn: values.manufacturedOn,
    expiresOn: values.expiresOn,
    quantity: wholeNumber(values.quantity) ?? 0,
    note: noteOf(values.note),
  };
}

// Correcting a batch's label: its number or its dates.
export const LABEL_FIELDS: readonly LabelField[] = [
  'batchNumber',
  'manufacturedOn',
  'expiresOn',
];
export type LabelErrors = Partial<Record<LabelField, string>>;

export function labelValues(batch: Batch): LabelValues {
  return {
    batchNumber: batch.batchNumber,
    manufacturedOn: batch.manufacturedOn,
    expiresOn: batch.expiresOn,
  };
}

export function checkLabel(values: LabelValues, now: Date): LabelErrors {
  return labelProblems(values, now);
}

// What a correction sends: only what changed.
export function labelChanges(values: LabelValues, batch: Batch): BatchLabel {
  const changed: BatchLabel = {};
  const number = tidyBatchNumber(values.batchNumber);
  if (number !== batch.batchNumber) {
    changed.batchNumber = number;
  }
  if (values.manufacturedOn !== batch.manufacturedOn) {
    changed.manufacturedOn = values.manufacturedOn;
  }
  if (values.expiresOn !== batch.expiresOn) {
    changed.expiresOn = values.expiresOn;
  }
  return changed;
}

// Changing a batch's stock: more of it arrived, or packs written off.
export type ChangeKind = 'RECEIVED' | 'DAMAGED' | 'EXPIRED';
export type ChangeField = 'packs' | 'note';
export type ChangeErrors = Partial<Record<ChangeField, string>>;

export interface ChangeValues {
  kind: ChangeKind;
  packs: string;
  note: string;
}

export function checkChange(values: ChangeValues, batch: Batch): ChangeErrors {
  const errors: ChangeErrors = {};
  const problem = packsProblem(values.packs, {
    empty: 'Enter how many packs',
    example: '2',
    least: 1,
  });
  if (problem) {
    errors.packs = problem;
  } else if (
    values.kind !== 'RECEIVED' &&
    (wholeNumber(values.packs) ?? 0) > batch.quantity
  ) {
    errors.packs =
      batch.quantity === 0
        ? 'This batch has no free packs to write off'
        : `At most ${packs(batch.quantity)}: the free packs of this batch`;
  }
  return errors;
}

export function toMovement(values: ChangeValues): MovementFields {
  const count = wholeNumber(values.packs) ?? 0;
  return {
    change: values.kind === 'RECEIVED' ? count : -count,
    reason: values.kind,
    note: noteOf(values.note),
  };
}

// Counting a batch's shelf: what was found, and why it differs.
export type CountField = 'counted' | 'note';
export type CountErrors = Partial<Record<CountField, string>>;

export interface CountValues {
  counted: string;
  note: string;
}

// onShelf: what the console showed should be there when counting began.
export function checkCount(
  values: CountValues,
  batch: Pick<Batch, 'awaitingPacking'>,
  onShelf: number,
): CountErrors {
  const errors: CountErrors = {};
  const problem = packsProblem(values.counted, {
    empty: 'Enter how many packs you counted',
    example: '30',
    least: 0,
  });
  if (problem) {
    errors.counted = problem;
    return errors;
  }
  const counted = wholeNumber(values.counted) ?? 0;
  if (counted < batch.awaitingPacking) {
    errors.counted = `Orders waiting to be packed need ${packs(
      batch.awaitingPacking,
    )} of this batch, more than you counted. Check those orders first.`;
  } else if (counted !== onShelf && !values.note.trim()) {
    errors.note = 'Say why the count differs';
  }
  return errors;
}

// What the count will do, as staff type it.
export function countHint(values: CountValues, onShelf: number): string {
  const counted = wholeNumber(values.counted);
  if (counted === null || counted > MAX_PACKS) {
    return 'Count the packs on the shelf, not those packed in boxes.';
  }
  const difference = counted - onShelf;
  if (difference === 0) {
    return 'It matches: nothing will change.';
  }
  return difference > 0
    ? `${packs(difference)} more than expected: the stock goes up.`
    : `${packs(-difference)} fewer than expected: the stock goes down.`;
}

export function toCount(values: CountValues, onShelf: number): CountFields {
  return {
    counted: wholeNumber(values.counted) ?? 0,
    onShelf,
    note: noteOf(values.note),
  };
}
