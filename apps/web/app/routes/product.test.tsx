import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MetaDescriptor } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Product } from '../catalog.server.ts';
import { smallSize } from '../components/Gallery.tsx';
import { renderPage } from '../test/render.tsx';
import ProductPage, { meta } from './product.tsx';

const MEDIA = 'http://127.0.0.1:3000/media/products';
const image = (key: string, altText = key, width = 1200, height = 1600) => ({
  url: `${MEDIA}/${key}-large.webp`,
  thumbnailUrl: `${MEDIA}/${key}-small.webp`,
  altText,
  width,
  height,
});
const ASHWAGANDHA: Product = {
  name: 'Ashwagandha Capsules',
  slug: 'ashwagandha-capsules',
  summary: 'For calm and strength',
  description: 'Made from the root.\nDried in the shade.',
  ingredients: 'Each capsule contains: Ashwagandha root extract 500 mg',
  usage: '1 capsule twice a day after meals',
  type: 'AYURVEDIC_MEDICINE',
  licenceNumber: '25D/123/2015',
  manufacturerName: 'Herbal Works Pvt Ltd',
  manufacturerAddress: '12, Industrial Area,\nMysuru 570016',
  countryOfOrigin: 'India',
  category: { name: 'Wellness', slug: 'wellness', parent: null },
  variants: [
    {
      sku: 'ASH-CAP-60',
      quantity: 60,
      unit: 'CAPSULES',
      mrpRupees: 500,
      priceRupees: 400,
      inStock: true,
    },
    {
      sku: 'ASH-CAP-120',
      quantity: 120,
      unit: 'CAPSULES',
      mrpRupees: 800,
      priceRupees: 800,
      inStock: false,
    },
  ],
  images: [
    image('front', 'The jar, from the front'),
    image('back', 'The back label, with the ingredients', 1600, 1200),
    image('open', 'The capsules'),
  ],
};

let asked: string[] = [];
beforeEach(() => {
  asked = [];
});

async function renderProduct(
  product: Product = ASHWAGANDHA,
  url = `/products/${product.slug}`,
) {
  renderPage({
    path: '/products/:slug',
    url,
    Component: ProductPage,
    loader: ({ request }) => {
      asked.push(new URL(request.url).search);
      const photo = Number(new URL(request.url).searchParams.get('photo') ?? 1);
      return { product, photo: photo - 1, origin: 'https://shop.example.com' };
    },
  });
  return screen.findByRole('heading', { level: 1 });
}

const packs = () =>
  within(
    screen.getByRole('heading', { level: 2, name: 'Pack sizes' })
      .parentElement as HTMLElement,
  );
const mainPhoto = () =>
  document.querySelector('article > div img') as HTMLImageElement;

describe('a product’s page', () => {
  it('names the product, its type and what it is for', async () => {
    const heading = await renderProduct();
    expect(heading).toHaveTextContent('Ashwagandha Capsules');
    expect(screen.getByText('Ayurvedic medicine')).toBeInTheDocument();
    expect(screen.getByText('For calm and strength')).toBeInTheDocument();
  });

  it('shows the way back: home, the shop, its category, and here', async () => {
    await renderProduct();
    const trail = screen.getByRole('navigation', { name: 'You are here' });
    expect(
      within(trail)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Home', '/'],
      ['Shop', '/shop'],
      ['Wellness', '/categories/wellness'],
    ]);
    expect(within(trail).getByText('Ashwagandha Capsules')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('passes through the top category, when its own is a subcategory (part 15B)', async () => {
    await renderProduct({
      ...ASHWAGANDHA,
      category: {
        name: 'Immunity',
        slug: 'immunity',
        parent: { name: 'Wellness', slug: 'wellness' },
      },
    });
    const trail = screen.getByRole('navigation', { name: 'You are here' });
    expect(
      within(trail)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Home', '/'],
      ['Shop', '/shop'],
      ['Wellness', '/categories/wellness'],
      ['Immunity', '/categories/immunity'],
    ]);
  });
});

describe('its packs', () => {
  it('each show its net quantity, its price, and its MRP', async () => {
    await renderProduct();
    const items = packs().getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('60 capsules');
    expect(items[0]).toHaveTextContent('₹400');
    expect(items[1]).toHaveTextContent('120 capsules');
    expect(items[1]).toHaveTextContent('MRP ₹800');
  });

  it('strike the MRP through and say what is saved, only when the price is lower', async () => {
    await renderProduct();
    const [cheaper, same] = packs().getAllByRole('listitem');
    expect(cheaper?.querySelector('s')).toHaveTextContent('MRP ₹500');
    expect(cheaper).toHaveTextContent('You save ₹100');
    expect(same?.querySelector('s')).toBeNull();
    expect(same).not.toHaveTextContent('You save');
  });

  it('say whether each can be bought today', async () => {
    await renderProduct();
    const [inStock, outOfStock] = packs().getAllByRole('listitem');
    expect(inStock).toHaveTextContent('In stock');
    expect(outOfStock).toHaveTextContent('Out of stock');
  });

  it('name every unit as its label would', async () => {
    const pack = (
      quantity: number,
      unit: Product['variants'][number]['unit'],
    ) => ({
      sku: `${unit}-${quantity}`,
      quantity,
      unit,
      mrpRupees: 100,
      priceRupees: 100,
      inStock: true,
    });
    await renderProduct({
      ...ASHWAGANDHA,
      variants: [
        pack(1000, 'G'),
        pack(1, 'KG'),
        pack(200, 'ML'),
        pack(1, 'L'),
        pack(1, 'CAPSULES'),
        pack(30, 'TABLETS'),
        pack(1, 'TABLETS'),
        pack(10, 'PIECES'),
        pack(1, 'PIECES'),
      ],
    });
    expect(
      packs()
        .getAllByRole('listitem')
        .map((item) => item.querySelector('[itemprop="name"]')?.textContent),
    ).toEqual([
      '1,000 g',
      '1 kg',
      '200 ml',
      '1 L',
      '1 capsule',
      '30 tablets',
      '1 tablet',
      '10 pieces',
      '1 piece',
    ]);
  });

  it('say so when none is on sale yet', async () => {
    await renderProduct({ ...ASHWAGANDHA, variants: [] });
    expect(
      packs().getByText('Not on sale yet. Please come back soon.'),
    ).toBeInTheDocument();
    expect(packs().queryByRole('list')).not.toBeInTheDocument();
  });

  it('come with the delivery terms and GST', async () => {
    await renderProduct();
    expect(
      packs().getByText(
        'Prices include GST. Delivery is free on orders of ₹499 or more, and ₹49 below that.',
      ),
    ).toBeInTheDocument();
  });
});

describe('what it is and how to use it', () => {
  it('shows staff’s words with their lines kept, as text', async () => {
    await renderProduct();
    for (const [heading, words] of [
      ['About it', 'Made from the root.\nDried in the shade.'],
      ['Ingredients', ASHWAGANDHA.ingredients],
      ['How to use it', ASHWAGANDHA.usage],
    ] as const) {
      const section = screen
        .getByRole('heading', { level: 2, name: heading })
        .closest('section') as HTMLElement;
      const paragraph = section.querySelector('p') as HTMLElement;
      expect(paragraph.textContent, heading).toBe(words);
      expect(paragraph).toHaveClass('whitespace-pre-line');
    }
  });

  it('leaves out what staff didn’t write', async () => {
    await renderProduct({ ...ASHWAGANDHA, description: null, usage: null });
    expect(
      screen.queryByRole('heading', { name: 'About it' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'How to use it' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Ingredients' }),
    ).toBeInTheDocument();
  });

  it('shows words as text, never as page code', async () => {
    await renderProduct({
      ...ASHWAGANDHA,
      name: '<img src=x onerror=alert(1)>',
      ingredients: '<script>alert(1)</script>',
    });
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: '<img src=x onerror=alert(1)>',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('its licence and maker', () => {
  const facts = () => {
    const list = screen
      .getByRole('heading', { level: 2, name: 'Licence and maker' })
      .closest('section')
      ?.querySelector('dl') as HTMLElement;
    return [...list.querySelectorAll('dt')].map((term) => [
      term.textContent,
      term.nextElementSibling?.textContent,
    ]);
  };

  it('are shown in full, as Indian labelling rules want', async () => {
    await renderProduct();
    expect(facts()).toEqual([
      ['AYUSH licence', '25D/123/2015'],
      ['Made by', 'Herbal Works Pvt Ltd'],
      ['Maker’s address', '12, Industrial Area,\nMysuru 570016'],
      ['Country of origin', 'India'],
    ]);
  });

  it('name the licence for the product’s type', async () => {
    await renderProduct({ ...ASHWAGANDHA, type: 'FOOD_OR_SUPPLEMENT' });
    expect(facts()[0]?.[0]).toBe('FSSAI licence');
  });

  it('name a cosmetic’s licence', async () => {
    await renderProduct({ ...ASHWAGANDHA, type: 'COSMETIC' });
    expect(facts()[0]?.[0]).toBe('Cosmetics licence');
    expect(screen.getByText('Cosmetic')).toBeInTheDocument();
  });
});

describe('its photos', () => {
  it('show the first large, described, in a square kept while it loads, first to load', async () => {
    await renderProduct();
    const photo = mainPhoto();
    expect(photo).toHaveAccessibleName('The jar, from the front');
    expect(photo).toHaveAttribute('src', `${MEDIA}/front-large.webp`);
    expect(photo).toHaveAttribute('width', '1200');
    expect(photo).toHaveAttribute('height', '1600');
    expect(photo).toHaveAttribute('fetchpriority', 'high');
    // The small file is 300 × 400: it fits 400 on its longest side.
    expect(photo.getAttribute('srcset')).toBe(
      `${MEDIA}/front-small.webp 300w, ${MEDIA}/front-large.webp 1200w`,
    );
  });

  it('work out the small file’s size, which fits 400 on its longest side', () => {
    expect(smallSize({ width: 1200, height: 1600 })).toEqual({
      width: 300,
      height: 400,
    });
    expect(smallSize({ width: 1600, height: 1200 })).toEqual({
      width: 400,
      height: 300,
    });
    expect(smallSize({ width: 300, height: 200 })).toEqual({
      width: 300,
      height: 200,
    });
  });

  it('show another in its place from its thumbnail, without leaving the page', async () => {
    await renderProduct();
    const thumbnails = within(
      screen.getByRole('list', { name: 'Photos' }),
    ).getAllByRole('link');
    expect(thumbnails.map((link) => link.getAttribute('aria-label'))).toEqual([
      'Show photo 1 of 3',
      'Show photo 2 of 3',
      'Show photo 3 of 3',
    ]);
    expect(thumbnails[0]).toHaveAttribute('aria-current', 'true');
    await userEvent.click(thumbnails[1] as HTMLElement);
    expect(mainPhoto()).toHaveAccessibleName(
      'The back label, with the ingredients',
    );
    expect(mainPhoto()).toHaveClass('animate-fade-in');
    expect(mainPhoto()).not.toHaveAttribute('fetchpriority');
    expect(thumbnails[1]).toHaveAttribute('aria-current', 'true');
    expect(thumbnails[0]).not.toHaveAttribute('aria-current');
    // Nothing was asked of the server again.
    expect(asked).toEqual(['']);
  });

  it('leave a thumbnail opened with Ctrl to the browser', async () => {
    await renderProduct();
    const second = screen.getByRole('link', { name: 'Show photo 2 of 3' });
    // Kept from going anywhere in the test page itself.
    second.addEventListener('click', (event) => event.preventDefault());
    const user = userEvent.setup();
    await user.keyboard('{Control>}');
    await user.click(second);
    await user.keyboard('{/Control}');
    expect(mainPhoto()).toHaveAccessibleName('The jar, from the front');
  });

  it('are links to the page with that photo, for a page without a script', async () => {
    await renderProduct();
    const third = screen.getByRole('link', { name: 'Show photo 3 of 3' });
    expect(third).toHaveAttribute(
      'href',
      '/products/ashwagandha-capsules?photo=3',
    );
    expect(third.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('open on the photo the address names', async () => {
    await renderProduct(ASHWAGANDHA, '/products/ashwagandha-capsules?photo=3');
    expect(mainPhoto()).toHaveAccessibleName('The capsules');
  });

  it('leave thumbnails out when there is one photo', async () => {
    await renderProduct({
      ...ASHWAGANDHA,
      images: [image('front')],
    });
    expect(
      screen.queryByRole('list', { name: 'Photos' }),
    ).not.toBeInTheDocument();
  });

  it('show a leaf when no photo could be shown', async () => {
    await renderProduct({ ...ASHWAGANDHA, images: [] });
    expect(document.querySelector('article img')).toBeNull();
    expect(
      document.querySelector('article > div svg[aria-hidden="true"]'),
    ).toBeInTheDocument();
  });
});

describe('what search engines read from the page itself', () => {
  const props = (scope: Element, name: string) =>
    [...scope.querySelectorAll(`[itemprop="${name}"]`)].filter(
      (element) => element.parentElement?.closest('[itemscope]') === scope,
    );
  const value = (element: Element | undefined) =>
    element?.getAttribute('content') ??
    element?.getAttribute('href') ??
    element?.textContent;

  it('is a product, with its name, address, photos and description', async () => {
    await renderProduct();
    const product = document.querySelector(
      '[itemtype="https://schema.org/Product"]',
    ) as HTMLElement;
    expect(product).toHaveAttribute('itemscope');
    expect(value(props(product, 'name')[0])).toBe('Ashwagandha Capsules');
    expect(value(props(product, 'url')[0])).toBe(
      'https://shop.example.com/products/ashwagandha-capsules',
    );
    expect(props(product, 'image').map(value)).toEqual([
      `${MEDIA}/front-large.webp`,
      `${MEDIA}/back-large.webp`,
      `${MEDIA}/open-large.webp`,
    ]);
    expect(props(product, 'description').map(value)).toEqual([
      'For calm and strength',
    ]);
    expect(value(props(product, 'countryOfOrigin')[0])).toBe('India');
    const maker = props(product, 'manufacturer')[0] as Element;
    expect(maker).toHaveAttribute(
      'itemtype',
      'https://schema.org/Organization',
    );
    expect(value(props(maker, 'name')[0])).toBe('Herbal Works Pvt Ltd');
    expect(value(props(maker, 'address')[0])).toBe(
      '12, Industrial Area,\nMysuru 570016',
    );
    expect(props(product, 'address')).toEqual([]);
  });

  it('keeps the label a proper list: each fact one term and its words', async () => {
    await renderProduct();
    const list = document.querySelector('dl') as HTMLElement;
    for (const group of list.children) {
      expect(group.tagName).toBe('DIV');
      expect([...group.children].map((child) => child.tagName)).toEqual([
        'DT',
        'DD',
      ]);
    }
    expect(list.children).toHaveLength(4);
  });

  it('describes it from its longer words when it has no summary', async () => {
    await renderProduct({ ...ASHWAGANDHA, summary: null });
    const product = document.querySelector('[itemscope]') as HTMLElement;
    expect(props(product, 'description').map(value)).toEqual([
      'Made from the root.\nDried in the shade.',
    ]);
  });

  it('offers each pack in rupees, with its code and whether it is in stock', async () => {
    await renderProduct();
    const offers = [...document.querySelectorAll('[itemprop="offers"]')].map(
      (offer) =>
        ['sku', 'price', 'priceCurrency', 'availability'].map((name) =>
          value(props(offer, name)[0]),
        ),
    );
    expect(offers).toEqual([
      ['ASH-CAP-60', '400', 'INR', 'https://schema.org/InStock'],
      ['ASH-CAP-120', '800', 'INR', 'https://schema.org/OutOfStock'],
    ]);
  });
});

describe('what it tells link previews', () => {
  const tags = (product: Product = ASHWAGANDHA) =>
    meta({
      loaderData: { product, photo: 0, origin: 'https://shop.example.com' },
    } as unknown as Parameters<typeof meta>[0]) as MetaDescriptor[];
  const find = (all: MetaDescriptor[], key: string) =>
    all.find((tag) => 'property' in tag && tag.property === key) as
      { content: string } | undefined;

  it('is a product named by itself, at its one address', () => {
    const all = tags();
    expect(all).toContainEqual({
      title: 'Ashwagandha Capsules · Herbal Commerce',
    });
    expect(all).toContainEqual({
      name: 'description',
      content: 'For calm and strength',
    });
    expect(find(all, 'og:type')?.content).toBe('product');
    expect(all).toContainEqual({
      tagName: 'link',
      rel: 'canonical',
      href: 'https://shop.example.com/products/ashwagandha-capsules',
    });
  });

  it('shows its main photo, with its size and words', () => {
    const all = tags();
    expect(find(all, 'og:image')?.content).toBe(`${MEDIA}/front-large.webp`);
    expect(find(all, 'og:image:width')?.content).toBe('1200');
    expect(find(all, 'og:image:height')?.content).toBe('1600');
    expect(find(all, 'og:image:alt')?.content).toBe('The jar, from the front');
  });

  it('gives its lowest price in rupees', () => {
    const all = tags();
    expect(find(all, 'product:price:amount')?.content).toBe('400');
    expect(find(all, 'product:price:currency')?.content).toBe('INR');
  });

  it('gives no price while none is on sale, and plain words without a summary', () => {
    const all = tags({ ...ASHWAGANDHA, variants: [], summary: null });
    expect(find(all, 'product:price:amount')).toBeUndefined();
    expect(all).toContainEqual({
      name: 'description',
      content:
        'Ashwagandha Capsules at Herbal Commerce. Prices include GST, and delivery is free from ₹499.',
    });
  });

  it('falls back to the shop’s picture when no photo could be shown', () => {
    expect(
      find(tags({ ...ASHWAGANDHA, images: [] }), 'og:image')?.content,
    ).toMatch(/^https:\/\/shop\.example\.com\/.*preview-home.*\.jpg$/);
  });

  it('leaves the title to the status page when the page could not be made', () => {
    expect(
      meta({ loaderData: undefined } as unknown as Parameters<typeof meta>[0]),
    ).toEqual([]);
  });
});
