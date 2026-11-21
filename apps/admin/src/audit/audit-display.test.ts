import { describe, expect, it } from 'vitest';
import {
  ASHA_PERSON,
  ORDER_ID,
  PRODUCT_ID,
  RAVI_PERSON,
  VARIANT_ID,
  entryOf,
} from '../test/audit-fixtures';
import type { AuditEntry } from './audit-api';
import {
  changedFields,
  indiaDay,
  indiaTime,
  pieces,
  tell,
  toldText,
  valueText,
} from './audit-display';

const said = (changes: Partial<AuditEntry>) => toldText(tell(entryOf(changes)));
const linkOf = (changes: Partial<AuditEntry>) =>
  pieces(tell(entryOf(changes))).find((piece) => typeof piece !== 'string') as
    { text: string; to: string | null } | undefined;

const ofAsha = {
  targetType: 'user',
  targetId: ASHA_PERSON.id,
  target: ASHA_PERSON,
  subject: null,
  actorId: RAVI_PERSON.id,
  actor: RAVI_PERSON,
};

describe('the audit log in sentences', () => {
  it('tells what happened to an account, naming both people', () => {
    expect(said({ ...ofAsha, action: 'admin.invited' })).toBe(
      'Ravi Kumar invited Asha Verma as an Admin',
    );
    expect(said({ ...ofAsha, action: 'admin.invitation_resent' })).toBe(
      'Ravi Kumar sent Asha Verma the invitation again',
    );
    expect(said({ ...ofAsha, action: 'admin.authenticator_reset' })).toBe(
      'Ravi Kumar reset the authenticator app of Asha Verma',
    );
    expect(said({ ...ofAsha, action: 'admin.disabled' })).toBe(
      'Ravi Kumar disabled Asha Verma',
    );
    expect(said({ ...ofAsha, action: 'admin.enabled' })).toBe(
      'Ravi Kumar enabled Asha Verma',
    );
    expect(
      said({
        ...ofAsha,
        actorId: ASHA_PERSON.id,
        actor: ASHA_PERSON,
        action: 'admin.invite_accepted',
      }),
    ).toBe('Asha Verma accepted the invitation and chose a password');
    expect(
      said({
        ...ofAsha,
        actorId: ASHA_PERSON.id,
        actor: ASHA_PERSON,
        action: 'staff.mfa_set_up',
      }),
    ).toBe('Asha Verma set up their authenticator app');
    expect(
      said({
        ...ofAsha,
        actorId: null,
        actor: null,
        action: 'staff.mfa_set_up',
      }),
    ).toBe('A developer command set up the authenticator app of Asha Verma');
    expect(said({ ...ofAsha, action: 'staff.mfa_set_up' })).toBe(
      'Ravi Kumar set up the authenticator app of Asha Verma',
    );
    expect(
      said({
        ...ofAsha,
        targetType: 'session',
        targetId: 'x',
        target: null,
        action: 'staff.signed_in',
        actorId: ASHA_PERSON.id,
        actor: ASHA_PERSON,
      }),
    ).toBe('Asha Verma signed in');
    expect(
      said({
        ...ofAsha,
        actorId: null,
        actor: null,
        target: RAVI_PERSON,
        action: 'super_user.created',
      }),
    ).toBe('A developer command made the Super User account of Ravi Kumar');
  });

  it('names a removed Admin from what the entry kept, and one whose account is gone', () => {
    expect(
      said({
        ...ofAsha,
        target: null,
        action: 'admin.removed',
        before: { fullName: 'Dev Patel', email: 'dev@example.com' },
        after: null,
      }),
    ).toBe('Ravi Kumar removed Dev Patel');
    expect(said({ ...ofAsha, actor: null, action: 'admin.disabled' })).toBe(
      'Someone whose account is gone disabled Asha Verma',
    );
    expect(
      linkOf({
        ...ofAsha,
        target: null,
        action: 'admin.removed',
        before: { fullName: 'Dev Patel' },
      })?.to,
    ).toBeNull();
    expect(linkOf({ ...ofAsha, action: 'admin.disabled' })?.to).toBe('/admins');
  });

  it('tells each step of an order, linking to it', () => {
    expect(said({ action: 'order.packed' })).toBe(
      'Asha Verma packed order 7KQ2M9XDPA',
    );
    expect(
      said({
        action: 'order.shipped',
        after: {
          status: 'SHIPPED',
          courierName: 'Delhivery',
          trackingNumber: 'EE123',
        },
      }),
    ).toBe('Asha Verma handed order 7KQ2M9XDPA to Delhivery');
    expect(said({ action: 'order.delivered' })).toBe(
      'Asha Verma marked order 7KQ2M9XDPA delivered',
    );
    expect(said({ action: 'order.cancelled' })).toBe(
      'Asha Verma cancelled order 7KQ2M9XDPA',
    );
    expect(said({ action: 'order.shipment_corrected' })).toBe(
      'Asha Verma corrected the tracking of order 7KQ2M9XDPA',
    );
    expect(
      said({
        action: 'order.refund_given_back',
        after: { amountRupees: 498, givenBackNote: 'Bank transfer' },
      }),
    ).toBe('Asha Verma gave back ₹498 by hand for order 7KQ2M9XDPA');
    expect(linkOf({ action: 'order.packed' })).toEqual({
      text: '7KQ2M9XDPA',
      to: `/orders/${ORDER_ID}`,
    });
  });

  it('tells a change to the catalog, saying when only the place in the list changed', () => {
    const product = {
      targetType: 'product',
      targetId: PRODUCT_ID,
      subject: { name: 'Ashwagandha Capsules', parent: null },
    };
    expect(said({ ...product, action: 'product.created' })).toBe(
      'Asha Verma added the product Ashwagandha Capsules',
    );
    expect(
      said({
        ...product,
        action: 'product.updated',
        before: { priceRupees: 500 },
        after: { priceRupees: 450 },
      }),
    ).toBe('Asha Verma changed the product Ashwagandha Capsules');
    expect(
      said({
        ...product,
        action: 'product.updated',
        before: { position: 2 },
        after: { position: 0 },
      }),
    ).toBe('Asha Verma moved the product Ashwagandha Capsules');
    // Moved and changed at once: changed.
    expect(
      said({
        ...product,
        action: 'product.updated',
        before: { position: 2, name: 'Ashwagandha' },
        after: { position: 0, name: 'Ashwagandha Capsules' },
      }),
    ).toBe('Asha Verma changed the product Ashwagandha Capsules');
    expect(linkOf({ ...product, action: 'product.created' })?.to).toBe(
      `/catalog/products/${PRODUCT_ID}`,
    );

    const variant = {
      targetType: 'variant',
      targetId: VARIANT_ID,
      subject: {
        name: 'ASH-CAP-60',
        parent: { id: PRODUCT_ID, name: 'Ashwagandha Capsules' },
      },
    };
    expect(said({ ...variant, action: 'variant.updated' })).toBe(
      'Asha Verma changed the pack size ASH-CAP-60 of Ashwagandha Capsules',
    );
    expect(linkOf({ ...variant, action: 'variant.updated' })?.to).toBe(
      `/catalog/products/${PRODUCT_ID}`,
    );
    expect(
      said({
        targetType: 'image',
        targetId: 'i',
        subject: { name: null, parent: { id: PRODUCT_ID, name: 'Neem Oil' } },
        action: 'image.created',
      }),
    ).toBe('Asha Verma added an image of Neem Oil');
    expect(
      said({
        targetType: 'category',
        targetId: 'c',
        subject: { name: 'Hair Care', parent: null },
        action: 'category.updated',
      }),
    ).toBe('Asha Verma changed the category Hair Care');
  });

  it('names something deleted from what the entry kept, with no link', () => {
    const gone = {
      targetType: 'product',
      targetId: PRODUCT_ID,
      subject: null,
      action: 'product.deleted',
      before: { name: 'Old Oil' },
      after: null,
    };
    expect(said(gone)).toBe('Asha Verma deleted the product Old Oil');
    expect(linkOf(gone)?.to).toBeNull();
  });

  it('tells a change to the stock, with its packs and why', () => {
    const batch = {
      targetType: 'batch',
      targetId: 'b',
      subject: {
        name: 'AB2611',
        parent: { id: VARIANT_ID, name: 'ASH-CAP-60' },
      },
    };
    expect(
      said({
        ...batch,
        action: 'batch.received',
        before: null,
        after: { batchNumber: 'AB2611', quantity: 30 },
      }),
    ).toBe('Asha Verma received batch AB2611 of ASH-CAP-60: 30 packs');
    expect(said({ ...batch, action: 'batch.updated' })).toBe(
      'Asha Verma changed batch AB2611 of ASH-CAP-60',
    );
    expect(
      said({
        ...batch,
        action: 'stock.changed',
        before: { quantity: 30 },
        after: { quantity: 28, change: -2, reason: 'DAMAGED' },
      }),
    ).toBe(
      'Asha Verma changed the stock by −2 of batch AB2611 (Written off: damaged)',
    );
    expect(
      said({
        ...batch,
        action: 'stock.counted',
        after: { quantity: 29, onShelf: 29 },
      }),
    ).toBe('Asha Verma counted batch AB2611: 29 packs on the shelf');
    expect(linkOf({ ...batch, action: 'batch.updated' })?.to).toBe(
      `/stock/${VARIANT_ID}`,
    );
  });

  it('tells a change to a policy page, linking to it (ADR 0040)', () => {
    const policy = {
      targetType: 'policy_page',
      targetId: 'privacy',
      subject: null,
      actorId: RAVI_PERSON.id,
      actor: RAVI_PERSON,
    };
    expect(said({ ...policy, action: 'policy.draft_saved' })).toBe(
      'Ravi Kumar saved a draft of Privacy policy',
    );
    expect(said({ ...policy, action: 'policy.draft_discarded' })).toBe(
      'Ravi Kumar discarded the draft of Privacy policy',
    );
    expect(
      said({
        ...policy,
        targetId: 'contact',
        action: 'policy.published',
        after: { revision: 5, version: 3, characters: 1200 },
      }),
    ).toBe('Ravi Kumar published version 3 of Contact us');
    expect(linkOf({ ...policy, action: 'policy.published' })?.to).toBe(
      '/policies/privacy',
    );
    // A page the console does not know: named plainly, with no link.
    const unknown = { ...policy, targetId: 'cookies' };
    expect(said({ ...unknown, action: 'policy.draft_saved' })).toBe(
      'Ravi Kumar saved a draft of a policy page',
    );
    expect(linkOf({ ...unknown, action: 'policy.draft_saved' })?.to).toBeNull();
    expect(
      changedFields(
        entryOf({
          ...policy,
          action: 'policy.published',
          before: { revision: 4, version: 2 },
          after: { revision: 5, version: 3, characters: 1200 },
        }),
      ).map((field) => [field.label, field.before, field.after]),
    ).toEqual([
      ['Revision', '4', '5'],
      ['Version', '2', '3'],
      ['Characters', null, '1,200'],
    ]);
  });

  it('still shows an action it does not know, by its name', () => {
    expect(said({ action: 'report.exported' })).toBe(
      'Asha Verma did “report.exported”',
    );
  });
});

describe('what changed', () => {
  it('lists every field, as staff read it', () => {
    const fields = changedFields(
      entryOf({
        action: 'variant.updated',
        before: { priceRupees: 500, isActive: true, lowStockAt: null },
        after: { priceRupees: 450, isActive: false, lowStockAt: 1500 },
      }),
    );
    expect(fields).toEqual([
      { key: 'priceRupees', label: 'Price', before: '₹500', after: '₹450' },
      {
        key: 'isActive',
        label: 'Shown to customers',
        before: 'Yes',
        after: 'No',
      },
      { key: 'lowStockAt', label: 'Low stock at', before: '—', after: '1,500' },
    ]);
  });

  it('has only one side for something made or deleted', () => {
    expect(
      changedFields(entryOf({ before: null, after: { name: 'Neem Oil' } })),
    ).toEqual([
      { key: 'name', label: 'Name', before: null, after: 'Neem Oil' },
    ]);
  });

  it('gives dates and times in India, statuses and reasons in words, and an unknown field by its name', () => {
    expect(valueText('expiresOn', '2028-09-30T00:00:00.000Z')).toBe(
      '30 Sep 2028',
    );
    expect(valueText('givenBackAt', '2026-11-19T10:05:00.000Z')).toBe(
      '19 Nov 2026, 15:35',
    );
    expect(valueText('status', 'PACKED')).toBe('Packed');
    expect(valueText('reason', 'EXPIRED')).toBe('Written off: expired');
    expect(valueText('variants', [{}, {}])).toBe('2');
    expect(
      changedFields(entryOf({ before: null, after: { brandNew: 'x' } }))[0]
        ?.label,
    ).toBe('brandNew');
  });

  it('groups by the day in India', () => {
    // 20:00 in UTC is already the next day in India.
    expect(indiaDay('2026-11-19T20:00:00.000Z')).toBe('2026-11-20');
    expect(indiaTime('2026-11-19T20:00:00.000Z')).toBe('01:30');
  });
});
