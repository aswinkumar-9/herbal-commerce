import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MetaDescriptor } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderPage } from '../test/render.tsx';
import CategoryPage, { meta } from './category.tsx';

interface Shown {
  name: string;
  slug: string;
  description: string | null;
  parent: { name: string; slug: string } | null;
  subcategories: { name: string; slug: string; description: string | null }[];
}
const HAIR: Shown = {
  name: 'Hair Care',
  slug: 'hair-care',
  description: 'Oils and powders for the hair',
  parent: null,
  subcategories: [],
};
const product = (slug: string) => ({
  name: slug,
  slug,
  summary: null,
  fromPriceRupees: 199,
  imageUrl: null,
});
// Two pages of products: the second after "bhringraj-oil".
const PAGES: Record<
  string,
  { products: ReturnType<typeof product>[]; nextAfter: string | null }
> = {
  '': {
    products: [product('amla-oil'), product('bhringraj-oil')],
    nextAfter: 'bhringraj-oil',
  },
  'bhringraj-oil': {
    products: [product('hibiscus-powder'), product('neem-comb')],
    nextAfter: null,
  },
};

let asked: string[] = [];
beforeEach(() => {
  asked = [];
});

interface Preview {
  category: { name: string; slug: string; description: string | null };
  products: ReturnType<typeof product>[];
}

async function renderCategory(
  url = '/categories/hair-care',
  category: Shown = HAIR,
  pages = PAGES,
  previews: Preview[] = [],
) {
  renderPage({
    path: '/categories/:slug',
    url,
    Component: CategoryPage,
    loader: ({ request }) => {
      const address = new URL(request.url);
      asked.push(`${address.pathname}${address.search}`);
      const after = address.searchParams.get('after');
      return {
        category,
        ...(pages[after ?? ''] ?? { products: [], nextAfter: null }),
        previews: after ? [] : previews,
        after,
        origin: 'https://shop.example.com',
      };
    },
  });
  return screen.findByRole('heading', { level: 1 });
}

// The category's own products: a subcategory's are in a section below.
const names = () =>
  screen
    .getAllByRole('article')
    .filter((card) => !card.closest('section'))
    .map((card) => card.querySelector('h2')?.textContent);

describe('a category’s page', () => {
  it('names the category and says what it holds', async () => {
    const heading = await renderCategory();
    expect(heading).toHaveTextContent('Hair Care');
    expect(
      screen.getByText('Oils and powders for the hair'),
    ).toBeInTheDocument();
  });

  it('shows the way back: home, the shop, and here', async () => {
    await renderCategory();
    const trail = screen.getByRole('navigation', { name: 'You are here' });
    expect(
      within(trail)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Home', '/'],
      ['Shop', '/shop'],
    ]);
    expect(within(trail).getByText('Hair Care')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows its products in the order staff chose', async () => {
    await renderCategory();
    expect(names()).toEqual(['amla-oil', 'bhringraj-oil']);
    // The names are h2, straight under the page's h1: no level skipped.
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('leaves out a description staff didn’t give', async () => {
    await renderCategory('/categories/wellness', {
      ...HAIR,
      name: 'Wellness',
      slug: 'wellness',
      description: null,
    });
    expect(document.querySelector('header p')).toBeNull();
  });

  it('says so when it has nothing yet, with a way to the shop', async () => {
    await renderCategory('/categories/hair-care', HAIR, {
      '': { products: [], nextAfter: null },
    });
    expect(
      screen.getByText('Nothing here yet. Please come back soon.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'See all products' }),
    ).toHaveAttribute('href', '/shop');
  });
});

describe('a top category with subcategories (part 15B)', () => {
  const sub = (slug: string, name: string) => ({
    name,
    slug,
    description: null,
  });
  const TOP: Shown = {
    ...HAIR,
    subcategories: [
      sub('hair-oils', 'Hair Oils'),
      sub('hair-powders', 'Hair Powders'),
    ],
  };
  const PREVIEWS: Preview[] = [
    {
      category: sub('hair-oils', 'Hair Oils'),
      products: [product('bhringraj-oil'), product('brahmi-oil')],
    },
    {
      category: sub('hair-powders', 'Hair Powders'),
      products: [product('shikakai-powder')],
    },
  ];
  const sections = () =>
    screen.getAllByRole('region').map((section) => [
      within(section).getByRole('heading', { level: 2 }).textContent,
      within(section)
        .getAllByRole('heading', { level: 3 })
        .map((name) => name.textContent),
      within(section)
        .getByRole('link', { name: /^See all/ })
        .getAttribute('href'),
    ]);

  it('links to each of its subcategories, in the order staff chose', async () => {
    await renderCategory('/categories/hair-care', TOP, PAGES, PREVIEWS);
    const links = screen.getByRole('navigation', {
      name: 'Sections of Hair Care',
    });
    expect(
      within(links)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Hair Oils', '/categories/hair-oils'],
      ['Hair Powders', '/categories/hair-powders'],
    ]);
  });

  it('links to a lone subcategory too', async () => {
    await renderCategory('/categories/hair-care', {
      ...TOP,
      subcategories: [sub('hair-oils', 'Hair Oils')],
    });
    expect(
      within(
        screen.getByRole('navigation', { name: 'Sections of Hair Care' }),
      ).getByRole('link'),
    ).toHaveAttribute('href', '/categories/hair-oils');
  });

  it('has no links when it has no subcategories', async () => {
    await renderCategory();
    expect(
      screen.queryByRole('navigation', { name: 'Sections of Hair Care' }),
    ).not.toBeInTheDocument();
  });

  it('shows its own products first, then a few of each subcategory’s, with the way to all', async () => {
    await renderCategory('/categories/hair-care', TOP, PAGES, PREVIEWS);
    expect(names()).toEqual(['amla-oil', 'bhringraj-oil']);
    expect(sections()).toEqual([
      ['Hair Oils', ['bhringraj-oil', 'brahmi-oil'], '/categories/hair-oils'],
      ['Hair Powders', ['shikakai-powder'], '/categories/hair-powders'],
    ]);
    expect(
      screen.getByRole('link', { name: 'See all Hair Powders' }),
    ).toBeInTheDocument();
    // Its own come before the first subcategory's.
    const own = screen.getAllByRole('article')[0] as HTMLElement;
    const first = screen.getAllByRole('region')[0] as HTMLElement;
    expect(
      own.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('goes straight to its subcategories’ products when it has none of its own', async () => {
    await renderCategory(
      '/categories/hair-care',
      TOP,
      { '': { products: [], nextAfter: null } },
      PREVIEWS,
    );
    expect(
      screen.queryByText('Nothing here yet. Please come back soon.'),
    ).not.toBeInTheDocument();
    expect(sections()).toHaveLength(2);
  });

  it('says so when neither it nor its subcategories have anything yet', async () => {
    await renderCategory('/categories/hair-care', TOP, {
      '': { products: [], nextAfter: null },
    });
    expect(
      screen.getByText('Nothing here yet. Please come back soon.'),
    ).toBeInTheDocument();
  });

  it('shows its own products only on a later page, with the links still', async () => {
    await renderCategory(
      '/categories/hair-care?after=bhringraj-oil',
      TOP,
      PAGES,
      PREVIEWS,
    );
    expect(names()).toEqual(['hibiscus-powder', 'neem-comb']);
    expect(screen.queryAllByRole('region')).toEqual([]);
    expect(
      screen.getByRole('navigation', { name: 'Sections of Hair Care' }),
    ).toBeInTheDocument();
  });

  it('keeps the subcategories’ products below its own when showing more', async () => {
    await renderCategory('/categories/hair-care', TOP, PAGES, PREVIEWS);
    await userEvent.click(screen.getByRole('link', { name: 'Show more' }));
    await waitFor(() => expect(names()).toHaveLength(4));
    expect(sections()).toHaveLength(2);
  });
});

describe('a subcategory', () => {
  it('shows the way back through its top category', async () => {
    await renderCategory('/categories/hair-oils', {
      ...HAIR,
      name: 'Hair Oils',
      slug: 'hair-oils',
      parent: { name: 'Hair Care', slug: 'hair-care' },
    });
    const trail = screen.getByRole('navigation', { name: 'You are here' });
    expect(
      within(trail)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Home', '/'],
      ['Shop', '/shop'],
      ['Hair Care', '/categories/hair-care'],
    ]);
    expect(within(trail).getByText('Hair Oils')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('showing more', () => {
  it('is a link to the next ones, for a page without a script', async () => {
    await renderCategory();
    expect(screen.getByRole('link', { name: 'Show more' })).toHaveAttribute(
      'href',
      '/categories/hair-care?after=bhringraj-oil',
    );
  });

  it('adds the next ones below, says so, and puts the keyboard on the first', async () => {
    await renderCategory();
    await userEvent.click(screen.getByRole('link', { name: 'Show more' }));
    await waitFor(() =>
      expect(names()).toEqual([
        'amla-oil',
        'bhringraj-oil',
        'hibiscus-powder',
        'neem-comb',
      ]),
    );
    expect(screen.getByRole('link', { name: 'hibiscus-powder' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent(
      '2 more products shown',
    );
    // The page stayed: only the next ones were asked for.
    expect(asked).toEqual([
      '/categories/hair-care',
      '/categories/hair-care?after=bhringraj-oil',
    ]);
    // None are left.
    expect(
      screen.queryByRole('link', { name: 'Show more' }),
    ).not.toBeInTheDocument();
  });

  it('shows each product once, should the list have changed meanwhile', async () => {
    await renderCategory('/categories/hair-care', HAIR, {
      ...PAGES,
      'bhringraj-oil': {
        products: [product('bhringraj-oil'), product('neem-comb')],
        nextAfter: null,
      },
    });
    await userEvent.click(screen.getByRole('link', { name: 'Show more' }));
    await waitFor(() =>
      expect(names()).toEqual(['amla-oil', 'bhringraj-oil', 'neem-comb']),
    );
  });

  it('starts again on a later page, with a way back to the start', async () => {
    await renderCategory('/categories/hair-care?after=bhringraj-oil');
    expect(names()).toEqual(['hibiscus-powder', 'neem-comb']);
    expect(
      screen.getByRole('link', { name: 'Back to the start' }),
    ).toHaveAttribute('href', '/categories/hair-care');
  });
});

describe('what a category tells search engines and link previews', () => {
  const tags = (
    category: { name: string; slug: string; description: string | null },
    after: string | null = null,
  ) =>
    meta({
      loaderData: { category, after, origin: 'https://shop.example.com' },
    } as unknown as Parameters<typeof meta>[0]) as MetaDescriptor[];

  it('names it, describes it, and lists it at its own address', () => {
    const all = tags(HAIR);
    expect(all).toContainEqual({ title: 'Hair Care · Herbal Commerce' });
    expect(all).toContainEqual({
      name: 'description',
      content: 'Oils and powders for the hair',
    });
    expect(all).toContainEqual({
      tagName: 'link',
      rel: 'canonical',
      href: 'https://shop.example.com/categories/hair-care',
    });
  });

  it('describes it plainly when staff gave no words', () => {
    expect(
      tags({ name: 'Wellness', slug: 'wellness', description: null }),
    ).toContainEqual({
      name: 'description',
      content:
        'Wellness at Herbal Commerce. Prices include GST, and delivery is free from ₹499.',
    });
  });

  it('asks not to list a later page', () => {
    expect(tags(HAIR, 'bhringraj-oil')).toContainEqual({
      name: 'robots',
      content: 'noindex, follow',
    });
  });

  it('leaves the title to the status page when the page could not be made', () => {
    expect(
      meta({ loaderData: undefined } as unknown as Parameters<typeof meta>[0]),
    ).toEqual([]);
  });
});

describe('showing more, in a new tab', () => {
  it('is left to the browser when opened with Ctrl or another key', async () => {
    await renderCategory();
    const more = screen.getByRole('link', { name: 'Show more' });
    // Kept from going anywhere in the test page itself.
    more.addEventListener('click', (event) => event.preventDefault());
    // One session, so Ctrl is still held as the link is clicked.
    const user = userEvent.setup();
    await user.keyboard('{Control>}');
    await user.click(more);
    await user.keyboard('{/Control}');
    expect(asked).toEqual(['/categories/hair-care']);
    expect(names()).toHaveLength(2);
  });
});
