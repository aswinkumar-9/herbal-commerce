import { screen, waitFor } from '@testing-library/react';
import { data } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from './test/render.tsx';
import { ErrorBoundary, links, loader as rootLoader } from './root.tsx';
import { answer, contextWith } from './test/route-calls.ts';
import NotFound, { loader as notFoundLoader } from './routes/not-found.tsx';

const failingWith = (status: number) => () => {
  throw data(null, { status });
};

describe('what every page knows', () => {
  const SESSION = {
    accessToken: 'access.jwt.one',
    refreshToken: 'refresh-token-one-0123456789',
    accessEndsAt: Date.now() + 60_000,
    endsAt: Date.now() + 86_400_000,
  };
  const asked = (signedIn: boolean) =>
    rootLoader({
      context: contextWith(signedIn ? SESSION : null).context,
      request: new Request('http://localhost:3001/'),
      params: {},
    } as never);
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('is only whether a customer is signed in, and how many packs their cart holds: never their session', async () => {
    fetchMock.mockResolvedValue(
      answer(200, {
        items: [
          {
            product: { name: 'Tulsi Tea', slug: 'tulsi-tea', imageUrl: null },
            sku: 'TUL-TEA-100',
            quantity: 100,
            unit: 'G',
            mrpRupees: 250,
            priceRupees: 220,
            packs: 2,
            lineTotalRupees: 440,
            status: 'AVAILABLE',
          },
          {
            product: { name: 'Neem Soap', slug: 'neem-soap', imageUrl: null },
            sku: 'NEM-SOP-1',
            quantity: 1,
            unit: 'PIECES',
            mrpRupees: 90,
            priceRupees: 90,
            packs: 1,
            lineTotalRupees: 90,
            status: 'OUT_OF_STOCK',
          },
        ],
        packs: 2,
        subtotalRupees: 440,
        mrpTotalRupees: 500,
      }),
    );
    expect(await asked(true)).toEqual({ signedIn: true, cartPacks: 3 });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('http://127.0.0.1:3000/v1/me/cart');
    expect(new Headers(init.headers).get('authorization')).toBe(
      'Bearer access.jwt.one',
    );
  });

  it('asks nothing for a visitor', async () => {
    expect(await asked(false)).toEqual({ signedIn: false, cartPacks: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never turns a page away when the cart can’t be read', async () => {
    fetchMock.mockResolvedValue(answer(503, { message: 'Server busy' }));
    expect(await asked(true)).toEqual({ signedIn: true, cartPacks: null });
  });
});

describe('what every page asks for first', () => {
  it('preloads the shop’s own regular, medium and semibold fonts, fetched as fonts are', () => {
    const fonts = links().flatMap((link) =>
      'as' in link && link.as === 'font' ? [link] : [],
    );
    expect(fonts).toHaveLength(3);
    for (const [index, weight] of ['400', '500', '600'].entries()) {
      expect(fonts[index]).toMatchObject({
        rel: 'preload',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      });
      expect(fonts[index]?.href).toMatch(
        new RegExp(`poppins-latin-${weight}-normal\\.woff2$`),
      );
      // From the shop itself, never another site.
      expect(fonts[index]?.href).toMatch(/^\//);
    }
  });
});

describe('a page that can’t be made', () => {
  it('is "not found" for an address the shop doesn’t have, inside the site’s frame', async () => {
    renderPage({
      Component: () => null,
      loader: failingWith(404),
      ErrorBoundary,
    });
    expect(
      await screen.findByRole('heading', {
        name: 'We couldn’t find that page',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to the shop' }),
    ).toHaveAttribute('href', '/');
    expect(
      screen.getByRole('navigation', { name: 'Main' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.title).toBe('Page not found · Herbal Commerce'),
    );
  });

  it('says the shop is taking a break when the API is resting or busy, and offers to try again', async () => {
    renderPage({
      path: '/categories',
      url: '/categories?page=2',
      Component: () => null,
      loader: failingWith(503),
      ErrorBoundary,
    });
    expect(
      await screen.findByRole('heading', {
        name: 'The shop is taking a short break',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/categories?page=2',
    );
    await waitFor(() =>
      expect(document.title).toBe('Back in a moment · Herbal Commerce'),
    );
  });

  it('says something went wrong for any other failure, and never its details', async () => {
    renderPage({
      Component: () => null,
      loader: () => {
        throw new Error('secret detail');
      },
      ErrorBoundary,
    });
    expect(
      await screen.findByRole('heading', { name: 'Something went wrong' }),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('secret detail');
  });
});

describe('the "not found" page', () => {
  it('answers with the status 404, so search engines drop the address', () => {
    expect(notFoundLoader()).toMatchObject({ init: { status: 404 } });
  });

  it('says so and leads back to the shop', async () => {
    renderPage({
      path: '*',
      url: '/no-such-page',
      Component: NotFound,
      loader: () => null,
    });
    expect(
      await screen.findByRole('heading', {
        name: 'We couldn’t find that page',
      }),
    ).toBeInTheDocument();
  });
});
