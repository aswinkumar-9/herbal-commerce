import { screen, waitFor } from '@testing-library/react';
import { data } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderPage } from './test/render.tsx';
import { ErrorBoundary } from './root.tsx';
import NotFound, { loader as notFoundLoader } from './routes/not-found.tsx';

const failingWith = (status: number) => () => {
  throw data(null, { status });
};

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
