import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MetaDescriptor } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SearchPage } from '../catalog.server.ts';
import { readShopSearch } from '../shop-search.ts';
import { renderPage } from '../test/render.tsx';
import Shop, { meta } from './shop.tsx';

const CATEGORIES = [
  { name: 'Wellness', slug: 'wellness', description: null },
  { name: 'Hair Care', slug: 'hair-care', description: null },
];
const product = (name: string, slug: string, inStock = true) => ({
  name,
  slug,
  summary: null,
  fromPriceRupees: 299,
  imageUrl: null,
  inStock,
});
const FOUND: SearchPage = {
  products: [
    product('Tulsi Drops', 'tulsi-drops'),
    product('Tulsi Tea', 'tulsi-tea', false),
  ],
  total: 2,
  page: 1,
  nextPage: null,
};

// The addresses the page was asked for, as the loader saw them, and a way
// to hold the next answer back.
let asked: URL[] = [];
let holding: Promise<void> | null = null;
beforeEach(() => {
  asked = [];
  holding = null;
});

async function renderShop(url = '/shop', found: SearchPage = FOUND) {
  renderPage({
    path: '/shop',
    url,
    Component: Shop,
    loader: async ({ request }) => {
      const address = new URL(request.url);
      asked.push(address);
      if (holding) {
        await holding;
      }
      return {
        ...readShopSearch(address.searchParams),
        categories: CATEGORIES,
        found,
        origin: 'https://shop.example.com',
      };
    },
  });
  return screen.findByRole('heading', { level: 1, name: 'The shop' });
}

const lastAsked = () => {
  const address = asked.at(-1);
  return address ? `${address.pathname}${address.search}` : '';
};
const box = () => screen.getByRole('searchbox', { name: 'Search the shop' });
const openFilters = () => userEvent.click(screen.getByText('Filters'));

describe('the shop’s search', () => {
  it('shows what the address asks for, the words in the box', async () => {
    await renderShop('/shop?q=tulsi&category=wellness');
    expect(box()).toHaveValue('tulsi');
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue(
      'wellness',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: '2 products for “tulsi”' }),
    ).toBeInTheDocument();
    // A <search>, which browsers name as the page's search (jsdom can't).
    expect(document.querySelector('search')).toContainElement(box());
  });

  it('shows the products found in the API’s order, in stock first', async () => {
    await renderShop('/shop?q=tulsi');
    expect(
      screen
        .getAllByRole('article')
        .map((card) => card.querySelector('h3')?.textContent),
    ).toEqual(['Tulsi Drops', 'Tulsi Tea']);
    expect(screen.getAllByText('Out of stock')).toHaveLength(1);
  });

  it('searches when the form is sent, from the first page, with empty parts left out', async () => {
    await renderShop('/shop?q=tulsi&page=2');
    await userEvent.clear(box());
    await userEvent.type(box(), '  neem  ');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(lastAsked()).toBe('/shop?q=neem'));
  });

  it('shows a new choice from a list at once', async () => {
    await renderShop('/shop?q=tulsi');
    await openFilters();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Category' }),
      'hair-care',
    );
    await waitFor(() =>
      expect(lastAsked()).toBe('/shop?q=tulsi&category=hair-care'),
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Type' }),
      'ayurvedic-medicine',
    );
    await waitFor(() =>
      expect(lastAsked()).toBe(
        '/shop?q=tulsi&category=hair-care&type=ayurvedic-medicine',
      ),
    );
  });

  it('applies prices with its button, and keeps the keyboard where it was', async () => {
    await renderShop('/shop');
    await openFilters();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Lowest price in rupees' }),
      '100',
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Highest price in rupees' }),
      '500',
    );
    const apply = screen.getByRole('button', { name: 'Show results' });
    await userEvent.click(apply);
    await waitFor(() => expect(lastAsked()).toBe('/shop?min=100&max=500'));
    expect(apply).toHaveFocus();
  });

  it('sorts at once, with the best match offered only for words', async () => {
    await renderShop('/shop?q=tulsi');
    const sort = screen.getByRole('combobox', { name: 'Sort by' });
    expect(
      within(sort)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Best match',
      'Price, low to high',
      'Price, high to low',
      'Name, A to Z',
    ]);
    await userEvent.selectOptions(sort, 'Price, high to low');
    await waitFor(() =>
      expect(lastAsked()).toBe('/shop?q=tulsi&sort=price-desc'),
    );
    expect(sort).toHaveValue('price-desc');
  });

  it('sorts by name usually, without words', async () => {
    await renderShop('/shop');
    expect(
      within(screen.getByRole('combobox', { name: 'Sort by' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Name, A to Z', 'Price, low to high', 'Price, high to low']);
  });

  it('belongs to the form, so it works without a script too', async () => {
    await renderShop('/shop');
    const form = document.querySelector('search form');
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/shop');
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveAttribute(
      'form',
      form?.id,
    );
  });

  it('shows words as text, never as page code', async () => {
    await renderShop('/shop?q=%3Cimg%20src%3Dx%3E');
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: '2 products for “<img src=x>”',
      }),
    ).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('the filters in use', () => {
  it('each show as a chip that takes it away, and all go at once', async () => {
    await renderShop(
      '/shop?q=tulsi&category=hair-care&type=cosmetic&min=100&max=500',
    );
    const chips = within(
      screen.getByRole('list', { name: 'Filters in use' }),
    ).getAllByRole('link');
    expect(
      chips.map((chip) => [
        chip.textContent,
        chip.getAttribute('aria-label'),
        chip.getAttribute('href'),
      ]),
    ).toEqual([
      [
        'Hair Care',
        'Remove Hair Care',
        '/shop?q=tulsi&type=cosmetic&min=100&max=500',
      ],
      [
        'Cosmetic',
        'Remove Cosmetic',
        '/shop?q=tulsi&category=hair-care&min=100&max=500',
      ],
      [
        '₹100 to ₹500',
        'Remove ₹100 to ₹500',
        '/shop?q=tulsi&category=hair-care&type=cosmetic',
      ],
    ]);
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/shop?q=tulsi',
    );
    expect(screen.getByText('3 in use')).toBeInTheDocument();
  });

  it('name a price range open at one end', async () => {
    await renderShop('/shop?min=100');
    expect(
      screen.getByRole('link', { name: 'Remove From ₹100' }),
    ).toBeInTheDocument();
  });

  it('are not shown when none is in use', async () => {
    await renderShop('/shop?q=tulsi');
    expect(
      screen.queryByRole('list', { name: 'Filters in use' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/in use/)).not.toBeInTheDocument();
  });
});

describe('what was typed wrong', () => {
  it('is said beside the search box, which keeps the words', async () => {
    await renderShop('/shop?q=a');
    expect(box()).toHaveValue('a');
    expect(box()).toHaveAttribute('aria-invalid', 'true');
    expect(box()).toHaveAccessibleDescription(
      'Type at least 2 characters to search.',
    );
  });

  it('opens the filters to say what is wrong with a price', async () => {
    await renderShop('/shop?min=500&max=100');
    expect(document.querySelector('details')).toHaveAttribute('open');
    const highest = screen.getByRole('textbox', {
      name: 'Highest price in rupees',
    });
    expect(highest).toHaveAttribute('aria-invalid', 'true');
    expect(highest).toHaveAccessibleDescription(
      'The highest price is below the lowest.',
    );
    expect(highest).toHaveValue('100');
  });

  it('is not said when all is well, and the filters start closed', async () => {
    await renderShop('/shop?q=tulsi&min=100');
    expect(box()).not.toHaveAttribute('aria-invalid');
    expect(document.querySelector('details')).not.toHaveAttribute('open');
  });
});

describe('when nothing is found', () => {
  const NONE: SearchPage = { products: [], total: 0, page: 1, nextPage: null };

  it('says so for a search, with a way to all the products', async () => {
    await renderShop('/shop?q=zzz', NONE);
    expect(
      screen.getByText('Nothing matches your search.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Try fewer words or another spelling, or clear the filters.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'See all products' }),
    ).toHaveAttribute('href', '/shop');
  });

  it('says the shop is being stocked when nothing was asked', async () => {
    await renderShop('/shop', NONE);
    expect(
      screen.getByText('The shop is being stocked. Please come back soon.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'See all products' }),
    ).not.toBeInTheDocument();
  });

  it('leads back to the first page from one past the last', async () => {
    await renderShop('/shop?q=tulsi&page=9', {
      products: [],
      total: 30,
      page: 9,
      nextPage: null,
    });
    expect(
      screen.getByText('There are no more products to show here.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Back to the first page' }),
    ).toHaveAttribute('href', '/shop?q=tulsi');
    expect(
      screen.queryByRole('navigation', { name: 'Pages' }),
    ).not.toBeInTheDocument();
  });
});

describe('the pages of results', () => {
  it('lead to the page before and after, with the search kept', async () => {
    await renderShop('/shop?q=tulsi&page=2', {
      ...FOUND,
      total: 60,
      page: 2,
      nextPage: 3,
    });
    const pages = screen.getByRole('navigation', { name: 'Pages' });
    expect(pages).toHaveTextContent('Page 2 of 3');
    expect(
      within(pages).getByRole('link', { name: 'Previous page' }),
    ).toHaveAttribute('href', '/shop?q=tulsi');
    expect(
      within(pages).getByRole('link', { name: 'Next page' }),
    ).toHaveAttribute('href', '/shop?q=tulsi&page=3');
  });

  it('are not shown when all fit on one', async () => {
    await renderShop('/shop?q=tulsi');
    expect(
      screen.queryByRole('navigation', { name: 'Pages' }),
    ).not.toBeInTheDocument();
  });
});

describe('while the next results load', () => {
  it('shows shapes like cards, and tells a screen reader, until they come', async () => {
    await renderShop('/shop?q=tulsi');
    let release = (): void => undefined;
    holding = new Promise((resolve) => {
      release = resolve;
    });
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Sort by' }),
      'price-asc',
    );
    await waitFor(() =>
      expect(document.querySelectorAll('[data-skeleton]')).toHaveLength(8),
    );
    const results = screen
      .getByRole('heading', { level: 2 })
      .closest('section');
    expect(results).toHaveAttribute('aria-busy', 'true');
    expect(
      within(results as HTMLElement).getByRole('status'),
    ).toHaveTextContent('Finding products');
    release();
    await waitFor(() =>
      expect(document.querySelectorAll('[data-skeleton]')).toHaveLength(0),
    );
    expect(
      within(results as HTMLElement).getByRole('status'),
    ).toHaveTextContent('2 products for “tulsi”');
  });
});

describe('what the shop tells search engines and link previews', () => {
  const tags = (search: string, q?: string) =>
    meta({
      loaderData: {
        search: { q, page: 1 },
        origin: 'https://shop.example.com',
      },
      location: { search },
    } as unknown as Parameters<typeof meta>[0]) as MetaDescriptor[];

  it('is listed, at its own address, when nothing is asked', () => {
    const all = tags('');
    expect(all).toContainEqual({ title: 'Shop · Herbal Commerce' });
    expect(all).toContainEqual({
      tagName: 'link',
      rel: 'canonical',
      href: 'https://shop.example.com/shop',
    });
    expect(all).not.toContainEqual(expect.objectContaining({ name: 'robots' }));
  });

  it('asks not to be listed for a search or a filter, named by its words', () => {
    const all = tags('?q=tulsi', 'tulsi');
    expect(all).toContainEqual({
      title: 'Results for “tulsi” · Herbal Commerce',
    });
    expect(all).toContainEqual({ name: 'robots', content: 'noindex, follow' });
    expect(all).not.toContainEqual(
      expect.objectContaining({ rel: 'canonical' }),
    );
    expect(tags('?type=cosmetic')).toContainEqual({
      name: 'robots',
      content: 'noindex, follow',
    });
  });
});

describe('the form and the address', () => {
  it('follows the address when a link changes it', async () => {
    await renderShop('/shop?q=tulsi&category=wellness');
    await userEvent.click(
      screen.getByRole('link', { name: 'Remove Wellness' }),
    );
    await waitFor(() => expect(lastAsked()).toBe('/shop?q=tulsi'));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue(
        '',
      ),
    );
    expect(box()).toHaveValue('tulsi');
  });

  it('offers no page past the 100th, the most the API gives', async () => {
    await renderShop('/shop?page=100', {
      ...FOUND,
      total: 5000,
      page: 100,
      nextPage: 101,
    });
    const pages = screen.getByRole('navigation', { name: 'Pages' });
    expect(pages).toHaveTextContent('Page 100 of 100');
    expect(
      within(pages).queryByRole('link', { name: 'Next page' }),
    ).not.toBeInTheDocument();
  });
});
