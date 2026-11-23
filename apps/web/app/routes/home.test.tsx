import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MetaDescriptor } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderPage } from '../test/render.tsx';
import { fakeObservers } from '../test/observer.ts';
import Home, { meta } from './home.tsx';

const CATEGORIES = [
  { name: 'Wellness', slug: 'wellness', description: null },
  {
    name: 'Hair Care',
    slug: 'hair-care',
    description: 'Oils and powders for the hair',
  },
];

beforeEach(fakeObservers);

async function renderHome(categories: unknown[] = CATEGORIES) {
  renderPage({
    Component: Home,
    loader: () => ({ categories, origin: 'https://shop.example.com' }),
  });
  return screen.findByRole('heading', { level: 1 });
}

const section = (name: string) =>
  screen
    .getByRole('heading', { level: 2, name })
    .closest('section') as HTMLElement;

describe('the home page’s first screen', () => {
  it('says what the shop is in two lines broken where the thought breaks', async () => {
    const heading = await renderHome();
    expect(heading).toHaveAccessibleName(
      'Herbs from our fields, made with care.',
    );
    expect(
      [...heading.querySelectorAll('span')].map((line) =>
        line.textContent?.trim(),
      ),
    ).toEqual(['Herbs from our fields,', 'made with care.']);
  });

  it('has one main action, a gold pill to the shop', async () => {
    const heading = await renderHome();
    const hero = heading.closest('section') as HTMLElement;
    const actions = within(hero).getAllByRole('link');
    expect(actions).toHaveLength(1);
    expect(actions[0]).toHaveAccessibleName('Shop the herbs');
    expect(actions[0]).toHaveAttribute('href', '/shop');
    expect(actions[0]).toHaveClass('bg-gold', 'text-on-gold', 'rounded-full');
  });

  it('states only true facts: prices with GST, free delivery from ₹499, and three proofs', async () => {
    const heading = await renderHome();
    const hero = heading.closest('section') as HTMLElement;
    expect(hero).toHaveTextContent(
      'Prices include GST, and delivery is free from ₹499.',
    );
    expect(
      within(hero)
        .getAllByRole('listitem')
        .map((item) => item.textContent?.trim()),
    ).toEqual(['Made in India', 'AYUSH licensed Ayurveda', 'Tested in a lab']);
  });

  it('shows the owner’s wide picture, or the tall one on a phone held upright, first to load', async () => {
    const heading = await renderHome();
    const hero = heading.closest('section') as HTMLElement;
    const source = hero.querySelector('picture source') as HTMLSourceElement;
    expect(source.media).toBe(
      '(max-width: 47.999rem) and (orientation: portrait)',
    );
    expect(source.srcset).toMatch(
      /hero-tall-640\.webp 640w, .*hero-tall-941\.webp 941w/,
    );
    const picture = hero.querySelector('img') as HTMLImageElement;
    expect(picture.srcset).toMatch(
      /hero-wide-960\.webp 960w, .*hero-wide-1672\.webp 1672w/,
    );
    expect(picture).toHaveAttribute('fetchpriority', 'high');
    expect(picture).toHaveAttribute('width', '1672');
    expect(picture).toHaveAttribute('height', '941');
    // It sets the mood; the words say it all.
    expect(picture).toHaveAttribute('alt', '');
  });

  it('puts its words in white on a veil that rises behind all of them', async () => {
    const heading = await renderHome();
    expect(heading.parentElement).toHaveClass('text-white');
    expect(heading.parentElement?.parentElement).toHaveClass('scrim-rise');
  });
});

describe('the rest of the home page', () => {
  it('lists four promises, each a fact the owner gave', async () => {
    await renderHome();
    const promises = section('What you can count on');
    expect(
      within(promises)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual([
      'From our own fields',
      'Tested in a lab',
      'Licensed and labelled',
      'Six months or more',
    ]);
  });

  it('shows the owner’s fields with words a screen reader can read', async () => {
    await renderHome();
    const fields = section('Grown where we can see it');
    expect(within(fields).getByRole('img')).toHaveAccessibleName(
      'Two people sharing saffron tea on a terrace above fields of saffron flowers and herbs, at sunrise.',
    );
    expect(fields.querySelector('img')).toHaveAttribute('loading', 'lazy');
  });

  it('offers each picture in sizes between phone and wide screen', async () => {
    await renderHome();
    const fields = section('Grown where we can see it').querySelector('img');
    expect(fields?.getAttribute('srcset')).toMatch(
      /fields-960\.webp 960w, .*fields-1280\.webp 1280w, .*fields-1672\.webp 1672w/,
    );
    const roots = document.querySelector('img[srcset*="roots-"]');
    expect(roots?.getAttribute('srcset')).toMatch(
      /roots-640\.webp 640w, .*roots-960\.webp 960w, .*roots-1254\.webp 1254w/,
    );
    // A phone is sent what its screen shows: the page less its margins.
    expect(roots).toHaveAttribute(
      'sizes',
      '(min-width: 48rem) 28rem, calc(100vw - 3rem)',
    );
  });

  it('has the tagline, every word its own', async () => {
    await renderHome();
    const tagline = screen.getByRole('region', {
      name: 'Grown slowly in our fields, tested with care, and sent to your home.',
    });
    expect(tagline.querySelectorAll('[data-word]')).toHaveLength(13);
  });

  it('explains how buying works in three numbered steps', async () => {
    await renderHome();
    const steps = within(section('How it works')).getAllByRole('listitem');
    expect(steps.map((step) => step.querySelector('h3')?.textContent)).toEqual([
      'Choose your herbs',
      'Pay online',
      'We pack and send',
    ]);
    expect(steps[0]).toHaveTextContent('01');
  });

  it('lists the categories in the order staff chose, each a link to its page', async () => {
    await renderHome();
    const shop = section('Shop by category');
    expect(shop).toHaveAttribute('id', 'shop');
    expect(
      within(shop)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Wellness', '/categories/wellness'],
      ['Hair Care', '/categories/hair-care'],
    ]);
  });

  it('says the shop is being stocked while no category is showing', async () => {
    await renderHome([]);
    const shop = section('Shop by category');
    expect(shop).toHaveTextContent(
      'The shop is being stocked. Please come back soon.',
    );
    expect(within(shop).queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows a category’s name as text, never as page code', async () => {
    await renderHome([
      { name: '<img src=x onerror=alert(1)>', slug: 'x', description: null },
    ]);
    expect(
      within(section('Shop by category')).getByText(
        '<img src=x onerror=alert(1)>',
      ),
    ).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('answers the usual questions, each opening on its own', async () => {
    await renderHome();
    const questions = section('Questions');
    const asked = questions.querySelectorAll('details');
    expect(asked).toHaveLength(7);
    const delivery = [...asked].find((item) =>
      item.textContent?.includes('How much is delivery?'),
    ) as HTMLDetailsElement;
    expect(delivery.open).toBe(false);
    await userEvent.click(within(delivery).getByText('How much is delivery?'));
    expect(delivery.open).toBe(true);
    expect(delivery).toHaveTextContent(
      'Free on orders of ₹499 or more. Below that, delivery is ₹49.',
    );
  });

  it('ends with the same action as it starts', async () => {
    await renderHome();
    const closing = section('Find the herbs that suit you');
    expect(
      within(closing).getByRole('link', { name: 'Shop the herbs' }),
    ).toHaveAttribute('href', '/shop');
  });
});

describe('what the home page tells search engines and link previews', () => {
  const tags = (loaderData?: { origin: string }) =>
    meta({ loaderData } as unknown as Parameters<
      typeof meta
    >[0]) as MetaDescriptor[];
  const find = (all: MetaDescriptor[], key: string) =>
    all.find((tag) => 'property' in tag && tag.property === key) as
      { content: string } | undefined;

  it('has its title and description', () => {
    const all = tags({ origin: 'https://shop.example.com' });
    expect(all).toContainEqual({
      title: 'Herbal Commerce · Herbs from our own fields',
    });
    expect(all).toContainEqual({
      name: 'description',
      content:
        'Herbs grown on our own fields, tested in a lab and made in India. Prices include GST, and delivery is free from ₹499.',
    });
  });

  it('names its own whole address, and a preview picture at a whole address', () => {
    const all = tags({ origin: 'https://shop.example.com' });
    expect(all).toContainEqual({
      tagName: 'link',
      rel: 'canonical',
      href: 'https://shop.example.com/',
    });
    expect(find(all, 'og:url')?.content).toBe('https://shop.example.com/');
    expect(find(all, 'og:image')?.content).toMatch(
      /^https:\/\/shop\.example\.com\/.*preview-home.*\.jpg$/,
    );
    expect(find(all, 'og:image:width')?.content).toBe('1200');
    expect(find(all, 'og:image:height')?.content).toBe('630');
    expect(find(all, 'og:image:alt')?.content).toBeTruthy();
    expect(find(all, 'og:locale')?.content).toBe('en_IN');
    expect(all).toContainEqual({
      name: 'twitter:card',
      content: 'summary_large_image',
    });
  });

  it('has its title alone when the page could not be made', () => {
    expect(tags()).toEqual([
      { title: 'Herbal Commerce · Herbs from our own fields' },
    ]);
  });
});
