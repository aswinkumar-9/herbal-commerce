import { rupees } from '../catalog/products/pack-size-form';
import { STATUS_NAMES } from '../orders/order-display';
import type { OrderStatus } from '../orders/orders-api';
import { POLICY_TITLES, isPolicyPage } from '../policies/policy-pages';
import {
  REASON_NAMES,
  dayName,
  momentName,
  packs,
  signed,
} from '../stock/stock-display';
import type { StockReason } from '../stock/stock-api';
import type { AuditEntry, AuditFields, AuditKind } from './audit-api';

// The audit log in words (ADR 0038): one sentence for each entry, such as
// "Asha Verma packed order 7KQ2M9XDPA", and on request what changed, field
// by field. The thing changed links to its page while it still exists.

export const KIND_NAMES: Record<AuditKind, string> = {
  accounts: 'Admins and accounts',
  sign_ins: 'Sign-ins',
  orders: 'Orders and refunds',
  catalog: 'Catalog',
  stock: 'Stock',
  policies: 'Policy pages',
};

// The thing an entry is about, and its page.
export interface Thing {
  text: string;
  to: string | null;
}

export interface Told {
  // Who acted.
  who: string;
  // What they did: words, and the thing it was done to.
  words: (string | Thing)[];
}

type Fields = NonNullable<AuditFields>;

function text(fields: AuditFields, key: string): string | null {
  const value = fields?.[key];
  return typeof value === 'string' ? value : null;
}

function count(fields: AuditFields, key: string): number | null {
  const value = fields?.[key];
  return typeof value === 'number' ? value : null;
}

// Who acted: the person while their account exists. An entry with no one
// came from a developer command.
export function whoActed(entry: AuditEntry): string {
  if (entry.actor) {
    return entry.actor.fullName;
  }
  return entry.actorId
    ? 'Someone whose account is gone'
    : 'A developer command';
}

// Only the position changed: a row was moved up or down its list.
function onlyMoved(entry: AuditEntry): boolean {
  const keys = Object.keys(entry.after ?? {});
  return keys.length === 1 && keys[0] === 'position';
}

// The page of the thing an entry is about, while it exists.
function pageOf(entry: AuditEntry): string | null {
  const { targetType, targetId, subject, target } = entry;
  if (!targetId) {
    return null;
  }
  if (targetType === 'user') {
    return target?.role === 'ADMIN' ? '/admins' : null;
  }
  if (!subject) {
    return null;
  }
  switch (targetType) {
    case 'order':
      return `/orders/${targetId}`;
    case 'product':
      return `/catalog/products/${targetId}`;
    case 'category':
      return '/catalog/categories';
    case 'brand':
      return '/catalog/brands';
    case 'variant':
    case 'image':
      return subject.parent ? `/catalog/products/${subject.parent.id}` : null;
    case 'batch':
      return subject.parent ? `/stock/${subject.parent.id}` : null;
    default:
      return null;
  }
}

// What the thing is called: now, or as the entry kept it if it is gone.
function nameOf(entry: AuditEntry, key: string, fallback: string): string {
  return (
    entry.subject?.name ??
    text(entry.after, key) ??
    text(entry.before, key) ??
    fallback
  );
}

function thing(entry: AuditEntry, name: string): Thing {
  return { text: name, to: pageOf(entry) };
}

// The person an account entry is about.
function personIn(entry: AuditEntry): Thing {
  const name =
    entry.target?.fullName ??
    text(entry.after, 'fullName') ??
    text(entry.before, 'fullName') ??
    'an account that is gone';
  return thing(entry, name);
}

function catalogWords(
  entry: AuditEntry,
  noun: string,
  name: Thing,
  belongsTo: string | null,
): (string | Thing)[] {
  const verb = entry.action.split('.')[1];
  const done =
    verb === 'created'
      ? 'added'
      : verb === 'deleted'
        ? 'deleted'
        : onlyMoved(entry)
          ? 'moved'
          : 'changed';
  return belongsTo
    ? [`${done} ${noun}`, name, `of ${belongsTo}`]
    : [`${done} ${noun}`, name];
}

// The policy page an entry is about, by its name (ADR 0040).
function policyPage(entry: AuditEntry): Thing {
  const page = entry.targetId ?? undefined;
  return isPolicyPage(page)
    ? { text: POLICY_TITLES[page], to: `/policies/${page}` }
    : { text: 'a policy page', to: null };
}

// One sentence for an entry. An action the console does not know yet is
// still shown, by its name.
export function tell(entry: AuditEntry): Told {
  const who = whoActed(entry);
  const parent = entry.subject?.parent?.name ?? null;
  const order = () => thing(entry, nameOf(entry, 'reference', 'an order'));
  switch (entry.action) {
    case 'super_user.created':
      return {
        who,
        words: ['made the Super User account of', personIn(entry)],
      };
    case 'admin.invited':
      return { who, words: ['invited', personIn(entry), 'as an Admin'] };
    case 'admin.invite_accepted':
      return {
        who,
        words: ['accepted the invitation and chose a password'],
      };
    case 'admin.invitation_resent':
      return { who, words: ['sent', personIn(entry), 'the invitation again'] };
    case 'admin.authenticator_reset':
      return {
        who,
        words: ['reset the authenticator app of', personIn(entry)],
      };
    case 'admin.disabled':
      return { who, words: ['disabled', personIn(entry)] };
    case 'admin.enabled':
      return { who, words: ['enabled', personIn(entry)] };
    case 'admin.removed':
      return { who, words: ['removed', personIn(entry)] };
    case 'staff.mfa_set_up':
      return entry.actorId !== null && entry.actorId === entry.targetId
        ? { who, words: ['set up their authenticator app'] }
        : { who, words: ['set up the authenticator app of', personIn(entry)] };
    case 'staff.signed_in':
      return { who, words: ['signed in'] };

    case 'order.packed':
      return { who, words: ['packed order', order()] };
    case 'order.shipped': {
      const courier = text(entry.after, 'courierName');
      return {
        who,
        words: courier
          ? ['handed order', order(), `to ${courier}`]
          : ['shipped order', order()],
      };
    }
    case 'order.delivered':
      return { who, words: ['marked order', order(), 'delivered'] };
    case 'order.cancelled':
      return { who, words: ['cancelled order', order()] };
    case 'order.shipment_corrected':
      return { who, words: ['corrected the tracking of order', order()] };
    case 'order.refund_given_back': {
      const amount = count(entry.after, 'amountRupees');
      return {
        who,
        words: [
          `gave back ${amount === null ? 'a refund' : rupees(amount)} by hand for order`,
          order(),
        ],
      };
    }

    case 'category.created':
    case 'category.updated':
    case 'category.deleted':
      return {
        who,
        words: catalogWords(
          entry,
          'the category',
          thing(entry, nameOf(entry, 'name', 'a category')),
          null,
        ),
      };
    case 'brand.created':
    case 'brand.updated':
    case 'brand.deleted':
      return {
        who,
        words: catalogWords(
          entry,
          'the brand',
          thing(entry, nameOf(entry, 'name', 'a brand')),
          null,
        ),
      };
    case 'product.created':
    case 'product.updated':
    case 'product.deleted':
      return {
        who,
        words: catalogWords(
          entry,
          'the product',
          thing(entry, nameOf(entry, 'name', 'a product')),
          null,
        ),
      };
    case 'variant.created':
    case 'variant.updated':
    case 'variant.deleted':
      return {
        who,
        words: catalogWords(
          entry,
          'the pack size',
          thing(entry, nameOf(entry, 'sku', 'a pack size')),
          parent,
        ),
      };
    case 'image.created':
    case 'image.updated':
    case 'image.deleted':
      return {
        who,
        words: catalogWords(
          entry,
          'an image',
          thing(entry, `of ${parent ?? 'a product'}`),
          null,
        ),
      };

    case 'batch.received': {
      const quantity = count(entry.after, 'quantity');
      return {
        who,
        words: [
          'received batch',
          thing(entry, nameOf(entry, 'batchNumber', 'a batch')),
          `${parent ? `of ${parent}` : ''}${quantity === null ? '' : `: ${packs(quantity)}`}`,
        ],
      };
    }
    case 'batch.updated':
      return {
        who,
        words: [
          'changed batch',
          thing(entry, nameOf(entry, 'batchNumber', 'a batch')),
          parent ? `of ${parent}` : '',
        ],
      };
    case 'stock.changed': {
      const change = count(entry.after, 'change');
      const reason = text(entry.after, 'reason') as StockReason | null;
      return {
        who,
        words: [
          `${change === null ? 'changed the stock' : `changed the stock by ${signed(change)}`} of batch`,
          thing(entry, nameOf(entry, 'batchNumber', 'a batch')),
          reason && REASON_NAMES[reason] ? `(${REASON_NAMES[reason]})` : '',
        ],
      };
    }
    case 'stock.counted': {
      const onShelf = count(entry.after, 'onShelf');
      return {
        who,
        words: [
          'counted batch',
          thing(entry, nameOf(entry, 'batchNumber', 'a batch')),
          onShelf === null ? '' : `: ${packs(onShelf)} on the shelf`,
        ],
      };
    }
    case 'policy.draft_saved':
      return { who, words: ['saved a draft of', policyPage(entry)] };
    case 'policy.draft_discarded':
      return { who, words: ['discarded the draft of', policyPage(entry)] };
    case 'policy.published': {
      const version = count(entry.after, 'version');
      return {
        who,
        words: [
          version === null ? 'published' : `published version ${version} of`,
          policyPage(entry),
        ],
      };
    }
    default:
      return { who, words: [`did “${entry.action}”`] };
  }
}

// The sentence in pieces, with the spaces between them: none before a
// colon, and none around an empty piece.
export function pieces({ who, words }: Told): (string | Thing)[] {
  const all: (string | Thing)[] = [who];
  for (const word of words) {
    const said = typeof word === 'string' ? word : word.text;
    if (said === '') {
      continue;
    }
    all.push(said.startsWith(':') ? '' : ' ', word);
  }
  return all.filter((piece) => piece !== '');
}

// The sentence as plain text: for tests, and for reading out.
export function toldText(told: Told): string {
  return pieces(told)
    .map((piece) => (typeof piece === 'string' ? piece : piece.text))
    .join('');
}

// The fields of a change, in words.
const FIELD_NAMES: Record<string, string> = {
  name: 'Name',
  fullName: 'Name',
  email: 'Email',
  role: 'Role',
  slug: 'Web address',
  summary: 'Summary',
  description: 'Description',
  ingredients: 'Ingredients',
  usage: 'How to use',
  type: 'Type',
  licenceNumber: 'Licence number',
  manufacturerName: 'Manufacturer',
  manufacturerAddress: 'Manufacturer’s address',
  countryOfOrigin: 'Country of origin',
  hsnCode: 'HSN code',
  gstRate: 'GST rate (%)',
  isActive: 'Shown to customers',
  position: 'Place in the list',
  categoryId: 'Category',
  brandId: 'Brand',
  productId: 'Product',
  variantId: 'Pack size',
  sku: 'SKU',
  unit: 'Unit',
  mrpRupees: 'MRP',
  priceRupees: 'Price',
  lowStockAt: 'Low stock at',
  altText: 'Description for screen readers',
  fileKey: 'File',
  width: 'Width (px)',
  height: 'Height (px)',
  batchNumber: 'Batch number',
  manufacturedOn: 'Made on',
  expiresOn: 'Expires on',
  quantity: 'Quantity',
  change: 'Change',
  reason: 'Reason',
  note: 'Note',
  onShelf: 'On the shelf',
  status: 'Status',
  courierName: 'Courier',
  trackingNumber: 'Tracking number',
  refundId: 'Refund',
  amountRupees: 'Amount',
  givenBackAt: 'Given back',
  givenBackNote: 'How it was given back',
  mfaEnabled: 'Authenticator app set up',
  invitationExpiresAt: 'Invitation link works until',
  invitationAcceptedAt: 'Accepted the invitation',
  authenticatorLinkExpiresAt: 'Link works until',
  variants: 'Pack sizes',
  images: 'Images',
  revision: 'Revision',
  version: 'Version',
  characters: 'Characters',
};

const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// A value as staff read it: a price in rupees, a date in India, yes or no.
export function valueText(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'number') {
    return key.endsWith('Rupees')
      ? rupees(value)
      : value.toLocaleString('en-IN');
  }
  if (typeof value === 'string') {
    if (key === 'status' && value in STATUS_NAMES) {
      return STATUS_NAMES[value as OrderStatus];
    }
    if (key === 'reason' && value in REASON_NAMES) {
      return REASON_NAMES[value as StockReason];
    }
    // A batch's dates are days, kept at midnight.
    if (key.endsWith('On') && (DAY.test(value) || MOMENT.test(value))) {
      return dayName(value.slice(0, 10));
    }
    if (MOMENT.test(value)) {
      return momentName(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.length === 1 ? '1' : value.length.toLocaleString('en-IN');
  }
  return JSON.stringify(value);
}

export interface ChangedField {
  key: string;
  label: string;
  before: string | null;
  after: string | null;
}

// What changed, field by field, in the order the entry kept them. Only
// one side is there when something was made (after) or deleted (before).
export function changedFields(entry: AuditEntry): ChangedField[] {
  const before: Fields = entry.before ?? {};
  const after: Fields = entry.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.map((key) => ({
    key,
    label: FIELD_NAMES[key] ?? key,
    before: entry.before && key in before ? valueText(key, before[key]) : null,
    after: entry.after && key in after ? valueText(key, after[key]) : null,
  }));
}

// An entry's day and time in India: the log is read in India.
function inIndia(at: string): string {
  return new Date(Date.parse(at) + 330 * 60_000).toISOString();
}

// "2026-11-19", to group the entries of one day.
export function indiaDay(at: string): string {
  return inIndia(at).slice(0, 10);
}

// "15:35".
export function indiaTime(at: string): string {
  return inIndia(at).slice(11, 16);
}
