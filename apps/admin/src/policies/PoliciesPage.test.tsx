import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { openSignedIn } from '../test/console';
import { ASHA, RAVI } from '../test/fake-api';
import {
  POLICIES,
  RAVI_REF,
  SAVED_AT,
  V2,
  summariesOf,
} from '../test/policy-fixtures';

describe('the policy pages list', () => {
  it('shows a Super User the five pages, where each stands, and a way to write it', async () => {
    openSignedIn('/policies', {
      staff: RAVI,
      answers: {
        [POLICIES]: summariesOf({
          privacy: { revision: 3, published: V2 },
          terms: {
            revision: 6,
            published: V2,
            draft: { updatedAt: SAVED_AT, updatedBy: RAVI_REF },
          },
          refunds: {
            revision: 1,
            draft: { updatedAt: SAVED_AT, updatedBy: RAVI_REF },
          },
        }),
      },
    });

    expect(
      await screen.findByRole('heading', { name: 'Policy pages', level: 1 }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.title).toBe('Policy pages · Herbal Commerce Admin'),
    );
    const rows = within(
      await screen.findByRole('list', { name: 'Policy pages' }),
    ).getAllByRole('listitem');
    expect(
      rows.map((row) => within(row).getByRole('link').textContent),
    ).toEqual([
      'Edit: Privacy policy',
      'Edit: Terms and conditions',
      'Edit: Refunds and cancellations',
      'Write: Shipping and delivery',
      'Write: Contact us',
    ]);
    const [privacy, terms, refunds, shipping] = rows as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    expect(privacy).toHaveTextContent('Privacy policyOn the website');
    expect(privacy).toHaveTextContent(
      'Version 2, published 21 Nov 2026 at 15:35 by Ravi Kumar.',
    );
    expect(terms).toHaveTextContent('Terms and conditionsChanges waiting');
    expect(terms).toHaveTextContent(
      'Draft saved 21 Nov 2026 at 17:00 by Ravi Kumar.',
    );
    expect(refunds).toHaveTextContent(
      'Refunds and cancellationsDraft, not published',
    );
    expect(shipping).toHaveTextContent('Shipping and deliveryNot written yet');
    expect(within(privacy).getByRole('link')).toHaveAttribute(
      'href',
      '/policies/privacy',
    );

    // In the menu, marked as the page open.
    const menu = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(menu).getByRole('link', { name: /Policy pages/ }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('says so when the list could not be loaded, and tries again', async () => {
    const { user } = openSignedIn('/policies', {
      staff: RAVI,
      answers: {
        [POLICIES]: [
          () => new Response(null, { status: 503 }),
          summariesOf({}),
        ],
      },
    });

    expect(
      await screen.findByText('The policy pages could not be loaded'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('list', { name: 'Policy pages' }),
    ).toBeInTheDocument();
  });

  it('is kept from an Admin, who sees no link to it either', async () => {
    const { api } = openSignedIn('/policies', { staff: ASHA });

    expect(
      await screen.findByRole('heading', {
        name: 'Only Super Users can open this page',
      }),
    ).toBeInTheDocument();
    const menu = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(menu).queryByRole('link', { name: /Policy pages/ }),
    ).not.toBeInTheDocument();
    expect(api.to('GET', '/v1/staff/policies')).toHaveLength(0);
  });
});
