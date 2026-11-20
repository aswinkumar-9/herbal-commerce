import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProductCard as Card } from '../catalog.server.ts';
import { renderPage } from '../test/render.tsx';
import { ProductGrid, ProductGridSkeleton } from './ProductCard.tsx';

const TULSI: Card = {
  name: 'Tulsi Drops',
  slug: 'tulsi-drops',
  summary: 'Holy basil in a few drops',
  fromPriceRupees: 1299,
  imageUrl: 'http://127.0.0.1:3000/media/products/k-small.webp',
};

function show(products: Card[]) {
  renderPage({ Component: () => <ProductGrid products={products} /> });
  return screen.getAllByRole('article');
}

describe('a product’s card', () => {
  it('is one link to the product’s page, named by the product', () => {
    const [card] = show([TULSI]);
    const links = within(card as HTMLElement).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Tulsi Drops');
    expect(links[0]).toHaveAttribute('href', '/products/tulsi-drops');
    expect(
      within(card as HTMLElement).getByRole('heading', { level: 3 }),
    ).toHaveTextContent('Tulsi Drops');
  });

  it('shows its lowest price on sale in whole rupees, as India writes them', () => {
    show([TULSI, { ...TULSI, slug: 'big', fromPriceRupees: 125000 }]);
    expect(screen.getByText('From ₹1,299')).toBeInTheDocument();
    expect(screen.getByText('From ₹1,25,000')).toBeInTheDocument();
  });

  it('says so when no pack is on sale yet', () => {
    show([{ ...TULSI, fromPriceRupees: null }]);
    expect(screen.getByText('Not on sale yet')).toBeInTheDocument();
  });

  it('says “Out of stock” only when the search says so', () => {
    show([
      { ...TULSI, slug: 'a', inStock: false },
      { ...TULSI, slug: 'b', inStock: true },
      { ...TULSI, slug: 'c' },
    ]);
    expect(screen.getAllByText('Out of stock')).toHaveLength(1);
  });

  it('shows its photo as decoration beside its name, the first row at once', () => {
    show(
      Array.from({ length: 6 }, (_, index) => ({
        ...TULSI,
        slug: `p-${index}`,
      })),
    );
    const photos = document.querySelectorAll('article img');
    expect(photos).toHaveLength(6);
    expect(photos[0]).toHaveAttribute('alt', '');
    expect(photos[0]).toHaveAttribute('src', TULSI.imageUrl);
    expect(photos[0]).toHaveAttribute('width', '400');
    expect(photos[0]).toHaveAttribute('height', '400');
    expect([...photos].map((photo) => photo.getAttribute('loading'))).toEqual([
      'eager',
      'eager',
      'eager',
      'eager',
      'lazy',
      'lazy',
    ]);
  });

  it('shows a leaf where a photo is missing', () => {
    const [card] = show([{ ...TULSI, imageUrl: null }]);
    expect(card?.querySelector('img')).toBeNull();
    expect(card?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows names and lines as text, never as page code', () => {
    show([
      {
        ...TULSI,
        name: '<img src=x onerror=alert(1)>',
        summary: '<script>alert(1)</script>',
      },
    ]);
    expect(
      screen.getByText('<img src=x onerror=alert(1)>'),
    ).toBeInTheDocument();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('leaves out the line about it when there is none', () => {
    const [card] = show([{ ...TULSI, summary: null }]);
    expect(card?.querySelectorAll('p')).toHaveLength(1);
  });
});

describe('cards still loading', () => {
  it('are shapes like cards, hidden from screen readers', () => {
    renderPage({ Component: () => <ProductGridSkeleton count={3} /> });
    const shapes = document.querySelectorAll('[data-skeleton]');
    expect(shapes).toHaveLength(3);
    expect(shapes[0]?.closest('ul')).toHaveAttribute('aria-hidden', 'true');
    expect(shapes[0]).toHaveClass('motion-safe:animate-pulse');
  });
});
