import { screen, within } from '@testing-library/react';
import type { MetaDescriptor } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Policy } from '../policies.server.ts';
import type { PolicyPage as Page } from '../policy-pages.ts';
import { renderPage } from '../test/render.tsx';
import PolicyPage, { meta } from './policy.tsx';

const ORIGIN = 'http://localhost:3001';
const PRIVACY: Policy = {
  body: [
    '## Who we are',
    '',
    'Herbal Commerce',
    'Market Road, Bengaluru',
    '',
    '## What we keep',
    '- Your name',
    '- Your address',
    '  for delivery',
  ].join('\n'),
  publishedAt: '2026-11-21T10:05:00.000Z',
  publishedOn: '21 November 2026',
};

function openPolicy(page: Page, policy: Policy | null) {
  return renderPage({
    path: '/:page',
    url: `/${page}`,
    Component: PolicyPage as never,
    loader: () => ({ page, policy, origin: ORIGIN }),
  });
}

const metaOf = (page: Page, policy: Policy | null) =>
  meta({
    loaderData: { page, policy, origin: ORIGIN },
  } as unknown as Parameters<typeof meta>[0]) as MetaDescriptor[];

describe('a policy page', () => {
  it('shows the published text, with the day it was last updated', async () => {
    openPolicy('privacy', PRIVACY);

    expect(
      await screen.findByRole('heading', { name: 'Privacy policy', level: 1 }),
    ).toBeInTheDocument();
    const updated = screen.getByText('21 November 2026');
    expect(updated.tagName).toBe('TIME');
    expect(updated).toHaveAttribute('dateTime', '2026-11-21T10:05:00.000Z');
    expect(updated.parentElement).toHaveTextContent(
      'Last updated 21 November 2026',
    );

    const article = screen.getByRole('article', { name: 'Privacy policy' });
    expect(
      within(article)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['Who we are', 'What we keep']);
    // An address keeps its lines; a list item its own.
    const address = within(article).getByText(/Herbal Commerce/);
    expect(address.textContent).toBe('Herbal Commerce\nMarket Road, Bengaluru');
    expect(address).toHaveClass('whitespace-pre-line');
    expect(
      within(within(article).getByRole('list'))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Your name', 'Your address\nfor delivery']);
    expect(within(article).getByText(/for delivery/)).toHaveClass(
      'whitespace-pre-line',
    );
  });

  it('shows the way back to the home page, outside the shop', async () => {
    openPolicy('terms', { ...PRIVACY, body: 'Terms.' });

    const trail = await screen.findByRole('navigation', {
      name: 'You are here',
    });
    expect(
      within(trail)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([['Home', '/']]);
    expect(within(trail).getByText('Terms and conditions')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('says calmly that a page not published yet is still being written, with a way on', async () => {
    openPolicy('refunds', null);

    expect(
      await screen.findByRole('heading', {
        name: 'Refunds and cancellations',
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('We are still writing this page.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Please come back soon.')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'See all products' }),
    ).toHaveAttribute('href', '/shop');
    expect(screen.queryByText(/Last updated/)).not.toBeInTheDocument();
  });

  it('shows code in the text as words, never running it', async () => {
    openPolicy('contact', {
      ...PRIVACY,
      body: '## <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>',
    });

    const article = await screen.findByRole('article', { name: 'Contact us' });
    expect(
      within(article).getByRole('heading', { level: 2 }),
    ).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(
      within(article).getByText('<script>alert(1)</script>'),
    ).toBeInTheDocument();
    expect(article.querySelector('img, script')).toBeNull();
  });
});

describe('what a policy page tells search engines and link previews', () => {
  it('names the page and its own address once published', () => {
    const tags = metaOf('shipping', PRIVACY);
    expect(tags).toContainEqual({
      title: 'Shipping and delivery · Herbal Commerce',
    });
    expect(tags).toContainEqual({
      name: 'description',
      content:
        'Where Herbal Commerce delivers, what delivery costs, and how long it takes.',
    });
    expect(tags).toContainEqual({
      tagName: 'link',
      rel: 'canonical',
      href: 'http://localhost:3001/shipping',
    });
    expect(tags).not.toContainEqual(
      expect.objectContaining({ name: 'robots' }),
    );
  });

  it('asks not to be listed while there is nothing to read', () => {
    const tags = metaOf('shipping', null);
    expect(tags).toContainEqual({ name: 'robots', content: 'noindex, follow' });
    expect(tags).not.toContainEqual(
      expect.objectContaining({ rel: 'canonical' }),
    );
  });

  it('names no page it could not make', () => {
    expect(
      meta({ loaderData: undefined } as unknown as Parameters<typeof meta>[0]),
    ).toEqual([]);
  });
});
