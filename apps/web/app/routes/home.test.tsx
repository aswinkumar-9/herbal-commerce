import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../test/render.tsx';
import Home, { meta } from './home.tsx';

const CATEGORIES = [
  { name: 'Wellness', slug: 'wellness', description: null },
  {
    name: 'Hair Care',
    slug: 'hair-care',
    description: 'Oils and powders for the hair',
  },
];

describe('the home page', () => {
  it('names the shop, and lists the categories in the order staff chose', async () => {
    renderPage({ Component: Home, loader: () => ({ categories: CATEGORIES }) });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Herbal Commerce' }),
    ).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(
      [...list.querySelectorAll('li')].map((item) => item.textContent),
    ).toEqual(['Wellness', 'Hair Care']);
  });

  it('says the shop is being stocked while no category is showing', async () => {
    renderPage({ Component: Home, loader: () => ({ categories: [] }) });
    expect(
      await screen.findByText(
        'The shop is being stocked. Please come back soon.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows a category’s name as text, never as page code', async () => {
    renderPage({
      Component: Home,
      loader: () => ({
        categories: [
          {
            name: '<img src=x onerror=alert(1)>',
            slug: 'x',
            description: null,
          },
        ],
      }),
    });
    expect(
      await screen.findByText('<img src=x onerror=alert(1)>'),
    ).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('has the shop’s name as its title, and a description for search engines', () => {
    const tags = meta({} as Parameters<typeof meta>[0]);
    expect(tags).toEqual([
      { title: 'Herbal Commerce' },
      {
        name: 'description',
        content: 'Herbal products, delivered across India.',
      },
    ]);
  });
});
